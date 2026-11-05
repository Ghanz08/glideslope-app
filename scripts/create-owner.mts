// One-time: create the single owner account (public sign-up is closed by a DB trigger after this).
// Usage: npm run create-owner -- you@example.com 'a-long-password'
import { createClient } from "@supabase/supabase-js";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 10) {
  console.error("Pakai: npm run create-owner -- <email> <kata-sandi minimal 10 karakter>");
  process.exit(1);
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1 });
if (existing?.users.length) {
  console.error(`Sudah ada pemilik (${existing.users[0].email}). Aplikasi ini hanya untuk satu pemilik; hapus akun itu dulu bila ingin menggantinya.`);
  process.exit(1);
}
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  console.error("Gagal membuat pemilik:", error.message);
  process.exit(1);
}
console.log("Pemilik dibuat:", data.user.id, "— masuk di /masuk lalu daftarkan TOTP.");
