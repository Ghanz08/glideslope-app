// Standard error shape (section 7.2) for Route Handlers and Server Actions.
import { NextResponse } from "next/server";

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string>; request_id: string };
}

export type ActionResult<T = object> = ({ ok: true } & T) | ApiError;

export function apiError(code: string, message: string, fields?: Record<string, string>): ApiError {
  return { error: { code, message, ...(fields ? { fields } : {}), request_id: crypto.randomUUID() } };
}

export function errorResponse(status: number, code: string, message: string, fields?: Record<string, string>) {
  return NextResponse.json(apiError(code, message, fields), { status });
}

/** zod issues → { field: message } */
export function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "_");
    out[k] ??= i.message;
  }
  return out;
}

/** Map Postgres exception codes raised by our RPCs to user-facing errors. */
const DB_MESSAGES: Record<string, string> = {
  AKUN_SAMA: "Akun asal dan tujuan harus berbeda.",
  AKUN_BELUM_DITENTUKAN: "Pilih akun dulu.",
  KATEGORI_KOSONG: "Pilih kategori dulu.",
  SUDAH_DIUBAH: "Item ini sudah berubah. Muat ulang lalu coba lagi.",
  STATUS_BERUBAH: "Item ini sudah berubah.",
  TIDAK_DITEMUKAN: "Data tidak ditemukan.",
  TRANSAKSI_HILANG: "Transaksi terkait sudah dihapus atau diabaikan.",
  SUDAH_DITAUTKAN: "Transaksi ini sudah ditautkan.",
  SUDAH_ADA_NOTA: "Transaksi ini sudah punya nota.",
  MELEBIHI_NILAI: "Jumlah melebihi nilai aset.",
  MELEBIHI_SISA: "Jumlah melebihi sisa piutang.",
  PIUTANG_SELESAI: "Piutang ini sudah selesai.",
  SUDAH_DIBAGIKAN: "Tagihan ini sudah dibagikan.",
  JUMLAH_TIDAK_SAMA: "Jumlah semua bagian belum sama dengan total nota.",
  SUDAH_ADA_PEMBAYARAN: "Tagihan sudah ada pembayaran, tidak bisa dibatalkan.",
  ASET_DIARSIPKAN: "Aset ini sudah diarsipkan.",
};

export function dbError(e: { message?: string; code?: string } | null): ApiError {
  const msg = e?.message ?? "";
  const key = Object.keys(DB_MESSAGES).find((k) => msg.includes(k));
  if (key) return apiError(key, DB_MESSAGES[key]);
  if (e?.code === "23505" || msg.includes("duplicate key")) return apiError("NAMA_SAMA", "Nama sudah dipakai.");
  console.error("db error", e?.code); // never log data, only the code
  return apiError("GALAT", "Perubahan belum tersimpan. Coba lagi.");
}
