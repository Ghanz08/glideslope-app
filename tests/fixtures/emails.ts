// Synthetic emails (OQ-2 default). Addresses end in `.example`; no real personal data.
import type { EmailInput, ParserId } from "../../src/lib/core/parsers";

export const SENDERS: Record<ParserId, { address: string; label: string }> = {
  mandiri: { address: "noreply@livin.mandiri.example", label: "Mandiri" },
  grab: { address: "no-reply@grab.example", label: "Grab" },
  shopee: { address: "info@shopee.example", label: "Shopee" },
  google_play: { address: "googleplay-noreply@google.example", label: "Google Play" },
  esb: { address: "receipt@esb.example", label: "ESB" },
  gojek: { address: "no-reply@gojek.example", label: "Gojek" },
};

const mk = (p: ParserId, subject: string, text: string, date = "2026-11-14T10:57:10Z"): EmailInput => ({
  from: SENDERS[p].address,
  subject,
  text,
  date,
});

export const mandiriQris = (amount = "Rp 40.000,00", ref = "123456787890", time = "17:57:04") =>
  mk("mandiri", "Bukti Transaksi QRIS", `Livin' by Mandiri
Transaksi Berhasil
Jenis Transaksi : Pembayaran QRIS
Penerima : PT Solusi Kasir Digital
Nominal : ${amount}
Tanggal : 14 Nov 2026
Waktu : ${time} WIB
No. Referensi : ${ref}
Sumber Dana : Mandiri ****4821`);

export const FIXTURES: Record<ParserId, { name: string; email: EmailInput; expect: "parsed" | "ignored" | "failed"; amounts?: number[] }[]> = {
  mandiri: [
    { name: "QRIS 40.000", email: mandiriQris(), expect: "parsed", amounts: [40000] },
    { name: "transfer keluar Rp 1,250,000.00", email: mk("mandiri", "Bukti Transfer", `Jenis Transaksi : Transfer
Penerima : RINA
Nominal : Rp 1,250,000.00
Tanggal : 13 November 2026
Waktu : 09:10:00
No. Referensi : 99887766554
Sumber Dana : Mandiri ****4821`), expect: "parsed", amounts: [1250000] },
    { name: "transfer masuk", email: mk("mandiri", "Transfer Masuk", `Jenis Transaksi : Transfer Masuk
Pengirim : RINA AYU
Nominal : Rp 150.000,00
Tanggal : 14 Nov 2026
Waktu : 08:00
No. Referensi : 55544433322`), expect: "parsed", amounts: [150000] },
    { name: "HTML top-up", email: mk("mandiri", "Bukti Top-up", `<html><body><table>
<tr><td>Jenis Transaksi</td><td>Top-up e-Wallet</td></tr>
<tr><td>Penerima</td><td>OVO 0812xxxx</td></tr>
<tr><td>Nominal</td><td>Rp&nbsp;101.000</td></tr>
<tr><td>Tanggal</td><td>14 Nov 2026</td></tr>
<tr><td>Waktu</td><td>12:00:00</td></tr>
<tr><td>No. Referensi</td><td>77700011122</td></tr></table></body></html>`), expect: "parsed", amounts: [101000] },
    { name: "gagal", email: mk("mandiri", "Transaksi Gagal", `Transaksi Gagal
Status : Gagal
Jenis Transaksi : Pembayaran QRIS
Nominal : Rp 25.000,00`), expect: "ignored" },
    // real Livin' layout (24 Okt 2026): a failed QR payment must not become spending
    { name: "Pembayaran Tidak Berhasil", email: mk("mandiri", "Pembayaran Tidak Berhasil", `Livin' by Mandiri
Pembayaran Tidak Berhasil
Halo PEMILIK CONTOH,
Berikut adalah detail transaksi Anda dengan QR:
Penerima
Olive Fried Chicken, Monj
SLEMAN - ID
Tanggal : 24 Okt 2026
Jam : 20:19:53 WIB
Nominal Transaksi : Rp 13.000,00
No. Referensi : 123456780889
Sumber Dana
PEMILIK CONTOH
****0706
Yuk, ulangi transaksi sesuai dengan kebutuhan Anda.`), expect: "ignored" },
    { name: "acak", email: mk("mandiri", "Promo", "Nikmati promo cashback akhir pekan!"), expect: "failed" },
  ],
  grab: [
    { name: "GrabFood OVO", email: mk("grab", "Your Grab E-Receipt", `Terima kasih telah memesan GrabFood
Pesanan ID: A-6KXQ2PJ1
Merchant: Ayam Bakar Bu Sri
Tanggal: 14 Nov 2026
Jam: 12:30
Total: Rp 48.000
Dibayar dengan: OVO`), expect: "parsed", amounts: [48000] },
    { name: "GrabCar tunai format koma", email: mk("grab", "Your Grab E-Receipt", `GrabCar
Pesanan ID: A-77ZZ
Tanggal: 10 Nov 2026
Jam: 07:45
Total: Rp 51,000
Dibayar dengan: Tunai`), expect: "parsed", amounts: [51000] },
    { name: "tanpa spasi", email: mk("grab", "E-Receipt", `Pesanan ID: A-1
Merchant: Kopi
Tanggal: 9 Nov 2026
Total: Rp517,500
Dibayar dengan: OVO`), expect: "parsed", amounts: [517500] },
    { name: "dibatalkan", email: mk("grab", "Pesanan dibatalkan", "Pesanan dibatalkan oleh pengemudi"), expect: "ignored" },
    { name: "tanpa total", email: mk("grab", "E-Receipt", "Pesanan ID: A-2\nTanggal: 9 Nov 2026"), expect: "failed" },
  ],
  shopee: [
    { name: "satu pesanan", email: mk("shopee", "Pembayaran Berhasil", `Tanggal Pesanan: 12 Nov 2026 20:15
Metode Pembayaran: ShopeePay
No. Pesanan: 2611120ABCD
Toko: Toko Bangunan Jaya
Total Pembayaran: Rp 819,376`), expect: "parsed", amounts: [819376] },
    { name: "dua pesanan", email: mk("shopee", "Pembayaran Berhasil", `Tanggal Pesanan: 12 Nov 2026 20:15
Metode Pembayaran: Mandiri
No. Pesanan: 26111A
Toko: A
Total Pembayaran: Rp 50.000
No. Pesanan: 26111B
Toko: B
Total Pembayaran: Rp 17.201,00`), expect: "parsed", amounts: [50000, 17201] },
    { name: "satu dibatalkan", email: mk("shopee", "Pembayaran Berhasil", `Tanggal Pesanan: 12 Nov 2026
No. Pesanan: X1
Total Pembayaran: Rp 10.000
No. Pesanan: X2
Status: Dibatalkan
Total Pembayaran: Rp 20.000`), expect: "parsed", amounts: [10000] },
    { name: "pembatalan", email: mk("shopee", "Pesanan Dibatalkan", "No. Pesanan: X"), expect: "ignored" },
    { name: "rusak", email: mk("shopee", "Info", "Halo, cek promo 11.11"), expect: "failed" },
  ],
  google_play: [
    { name: "langganan", email: mk("google_play", "Struk pesanan Google Play", `Nomor pesanan: GPA.3311-2211-4455-66778
Tanggal pesanan: 13 Nov 2026 10:00
Item: Langganan musik
Total: Rp 54990
Metode pembayaran: OVO`), expect: "parsed", amounts: [54990] },
    { name: "Rp 19800", email: mk("google_play", "Struk pesanan Google Play", `Nomor pesanan: GPA.1
Tanggal pesanan: 1 Nov 2026
Item: Game coin
Total: Rp 19800`), expect: "parsed", amounts: [19800] },
    { name: "tanpa tanggal pakai header", email: mk("google_play", "Struk pesanan Google Play", `Nomor pesanan: GPA.2
Total: Rp 15.000`), expect: "parsed", amounts: [15000] },
    { name: "refund", email: mk("google_play", "Refund Google Play", "Nomor pesanan: GPA.3"), expect: "ignored" },
    { name: "desimal salah", email: mk("google_play", "Struk", "Nomor pesanan: GPA.4\nTotal: Rp 12.5"), expect: "failed" },
  ],
  esb: [
    { name: "struk restoran", email: mk("esb", "Struk Pembayaran", `Outlet: Warung Mie Pak Dani
Kode Transaksi: ESB-20261114-0091
Tanggal: 14/11/2026
Jam: 17:57
Mie ayam spesial 1 x 12.727
Grand Total: Rp 40.000
Pembayaran: QRIS`), expect: "parsed", amounts: [40000] },
    { name: "format desimal", email: mk("esb", "Struk", `Outlet: Kedai Jus Taman
Kode Transaksi: ESB-2
Tanggal: 14 Nov 2026
Jam: 15:00
Grand Total: Rp 15.000,00`), expect: "parsed", amounts: [15000] },
    { name: "tanpa spasi", email: mk("esb", "Struk", `Outlet: Resto
Kode Transaksi: ESB-3
Tanggal: 13 Nov 2026
Total: Rp517,500`), expect: "parsed", amounts: [517500] },
    { name: "void", email: mk("esb", "Struk VOID", "Kode Transaksi: ESB-4"), expect: "ignored" },
    { name: "kosong", email: mk("esb", "Struk", "   "), expect: "failed" },
  ],
  gojek: [
    { name: "GoFood", email: mk("gojek", "Struk GoFood", `ID Struk: RB-552211
Restoran: Ayam Geprek Pak Eko
Tanggal: 14 Nov 2026
Jam: 11:20
Total Bayar: Rp 17.201,00
Metode Pembayaran: GoPay Tabungan`), expect: "parsed", amounts: [17201] },
    { name: "GoRide", email: mk("gojek", "Perjalanan GoRide", `ID Struk: RB-1
Layanan: GoRide
Tanggal: 13 Nov 2026
Jam: 07:00
Total Bayar: Rp 12.000
Metode Pembayaran: Tunai`), expect: "parsed", amounts: [12000] },
    { name: "angka koma ribuan", email: mk("gojek", "Struk GoMart", `ID Struk: RB-2
Merchant: Toko Obat Sehat
Tanggal: 14 Nov 2026
Total Bayar: Rp 63,500
Metode Pembayaran: GoPay`), expect: "parsed", amounts: [63500] },
    { name: "batal", email: mk("gojek", "Pesanan dibatalkan", "ID Struk: RB-3"), expect: "ignored" },
    { name: "acak", email: mk("gojek", "Hai", "lorem ipsum dolor"), expect: "failed" },
  ],
};

// Real Livin' layouts (Nov 2026 sample, values and names replaced). Type is in the subject; parties sit under their label.
const livin = (subject: string, body: string): EmailInput => ({ from: SENDERS.mandiri.address, subject, text: body, date: "2026-09-17T10:58:45Z" });
export const LIVIN_REAL: { name: string; email: EmailInput; amounts: number[]; kinds: string[]; merchant: string | null }[] = [
  {
    name: "QR payment",
    email: livin("Pembayaran Berhasil!", `Livin' by Mandiri
Pembayaran Berhasil
Halo PEMILIK CONTOH,
Berikut adalah detail transaksi Anda dengan QR:
Penerima
N001 MINIMARKET CONTOH
KOTA CONTOH - ID
Tanggal : 17 Sep 2026
Jam : 17:58:38 WIB
 Nominal Transaksi : Rp 11.000,00
No. Referensi : 123456784010
No. Ref. QRIS : 123456782465
Pengakuisisi : Bank Contoh
Sumber Dana
 PEMILIK CONTOH
 ****0706
Simpan email ini sebagai referensi transaksi Anda.`),
    amounts: [11000], kinds: ["expense"], merchant: "N001 MINIMARKET CONTOH",
  },
  {
    name: "top-up with fee",
    email: livin("Top-up Berhasil", `Livin' by Mandiri
Top-up Berhasil
Berikut adalah detail transaksi Anda:
Penyedia Jasa
GoPay Customer
****1234
Tanggal : 2 Sep 2026
Jam : 11:35:09 WIB
Nominal Top-up : Rp 24.000,00
Biaya Transaksi : Rp 1.200,00
Total Transaksi : Rp 25.200,00
No. Referensi : 123456781926
Rekening Sumber
PEMILIK CONTOH
****0706`),
    amounts: [24000, 1200], kinds: ["transfer_unknown", "expense"], merchant: "GoPay Customer ****1234",
  },
  {
    name: "transfer",
    email: livin("Transfer Berhasil", `Livin' by Mandiri
Transfer Berhasil
Penerima
PENERIMA CONTOH
 Bank Mandiri - ••••7800
Tanggal : 8 Sep 2026
Jam : 10:37:56 WIB
Jumlah Transfer : Rp 100.000,00
No. Referensi : 123456789552
Keterangan : -
Rekening Sumber
PEMILIK CONTOH
****0706`),
    amounts: [100000], kinds: ["transfer_unknown"], merchant: "PENERIMA CONTOH",
  },
  {
    name: "BI Fast with fee",
    email: livin("Transfer dengan BI Fast Berhasil", `Livin' by Mandiri
Transfer dengan BI Fast
Berhasil
Penerima
PENERIMA LAIN
 Seabank - ••••9606
Tanggal : 16 Sep 2026
Jam : 10:36:19 WIB
Nominal Transfer : Rp 45.000,00
Biaya Transfer : Rp 2.500,00
Total Transaksi : Rp 47.500,00
No. Referensi BI Fast : 20260916BMRIIDJA010O0000003625
Rekening Sumber
PEMILIK CONTOH
****0706`),
    amounts: [45000, 2500], kinds: ["transfer_unknown", "expense"], merchant: "PENERIMA LAIN",
  },
];
