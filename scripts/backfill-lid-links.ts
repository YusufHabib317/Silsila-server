/**
 * One-off backfill: recover phone numbers for LID-addressed WhatsApp contacts
 * from the `*Alt` fields stored in each message's raw payload, then link those
 * WhatsApp contacts to saved CRM contacts by phone number.
 *
 * Idempotent and safe to re-run. Pass `--apply` to write; default is dry-run.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const sql = neon(url);

const apply = process.argv.includes("--apply");

function norm(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "");
}

function jidToPhoneNumber(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [rawUser, domain] = jid.split("@");
  const user = rawUser?.split(":")[0] ?? "";
  if (!/^\d+$/.test(user) || (domain !== "s.whatsapp.net" && domain !== "c.us")) {
    return null;
  }
  return `+${user}`;
}

// Phone derived from message raw payloads, per whatsapp_contact.
const derived = await sql`
  select
    wc.id              as whatsapp_contact_id,
    wc.tenant_id       as tenant_id,
    wc.phone_number    as current_phone,
    wc.external_contact_id as external_contact_id,
    coalesce(
      max(case when c.external_chat_id = wc.external_contact_id
               then m.raw_payload_json -> 'key' ->> 'remoteJidAlt' end),
      max(case when m.sender_contact_id = wc.id
               then m.raw_payload_json -> 'key' ->> 'participantAlt' end)
    ) as alt_jid
  from whatsapp_contacts wc
  left join whatsapp_messages m on m.tenant_id = wc.tenant_id
  left join whatsapp_chats c on c.id = m.chat_id
  group by wc.id, wc.tenant_id, wc.phone_number, wc.external_contact_id`;

let phoneUpdates = 0;
let links = 0;

for (const row of derived) {
  const tenantId = row.tenant_id as string;
  const waContactId = row.whatsapp_contact_id as string;
  const externalContactId = row.external_contact_id as string;
  const phone =
    jidToPhoneNumber(externalContactId) ?? jidToPhoneNumber(row.alt_jid as string | null);

  if (!phone) continue;

  if (norm(row.current_phone as string | null) !== norm(phone)) {
    console.log(
      `phone: ${externalContactId} -> ${phone} (was ${row.current_phone ?? "null"})`,
    );
    phoneUpdates++;
    if (apply) {
      await sql`update whatsapp_contacts set phone_number = ${phone}, updated_at = now() where id = ${waContactId}`;
    }
  }

  // Already linked? skip (unique on tenant_id + whatsapp_contact_id).
  const existing = await sql`
    select 1 from contact_whatsapp_identities
    where tenant_id = ${tenantId} and whatsapp_contact_id = ${waContactId} limit 1`;
  if (existing.length > 0) continue;

  const candidates = await sql`
    select id, phone_number from contacts
    where tenant_id = ${tenantId} and deleted_at is null`;
  const matches = candidates.filter(
    (c) => norm(c.phone_number as string | null) === norm(phone),
  );

  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.log(`skip link ${externalContactId}: ${matches.length} contacts match ${phone}`);
    }
    continue;
  }

  const contactId = matches[0].id as string;
  console.log(`link: ${externalContactId} (${phone}) -> contact ${contactId}`);
  links++;
  if (apply) {
    await sql`
      insert into contact_whatsapp_identities (tenant_id, contact_id, whatsapp_contact_id)
      values (${tenantId}, ${contactId}, ${waContactId})
      on conflict do nothing`;
  }
}

console.log(
  `\n${apply ? "APPLIED" : "DRY-RUN"}: ${phoneUpdates} phone update(s), ${links} link(s).` +
    (apply ? "" : " Re-run with --apply to write."),
);
