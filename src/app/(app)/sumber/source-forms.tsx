"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveEmailSource } from "@/app/actions/sources";
import { Button, Field, inputClass, keepValues } from "@/components/ui";
import { toast } from "@/components/toast";

const PARSERS = [["", "Tanpa parser (dibaca LLM)"], ["mandiri", "Mandiri"], ["grab", "Grab"], ["shopee", "Shopee"], ["google_play", "Google Play"], ["esb", "ESB"], ["gojek", "Gojek"]];

export function AddSourceForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-3" onSubmit={keepValues((f, el) => start(async () => {
      const r = await saveEmailSource({
        sender_address: String(f.get("address")),
        label: String(f.get("label")),
        parser_id: String(f.get("parser") || "") || null,
        default_account_id: String(f.get("account") || "") || null,
      });
      if ("error" in r) return setErrors(r.error.fields ?? { sender_address: r.error.message });
      setErrors({});
      el.reset();
      toast({ text: "Pengirim ditambahkan." });
      router.refresh();
    }))}>
      <Field label="Alamat pengirim" name="address" error={errors.sender_address}><input id="address" name="address" type="email" className={inputClass(errors.sender_address)} /></Field>
      <Field label="Label" name="label" error={errors.label}><input id="label" name="label" maxLength={40} className={inputClass(errors.label)} /></Field>
      <Field label="Parser" name="parser"><select id="parser" name="parser" className={inputClass()}>{PARSERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Akun bawaan" name="account"><select id="account" name="account" className={inputClass()}><option value="">Tentukan dari isi email</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Button type="submit" disabled={pending}>Tambah pengirim</Button>
    </form>
  );
}

export function DisconnectButton() {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="sekunder" onClick={() => dlg.current?.showModal()}>Putuskan</Button>
      <dialog ref={dlg} aria-labelledby="putus-judul" className="m-auto w-[min(420px,calc(100%-32px))] rounded-kartu bg-permukaan p-6 shadow-e3">
        <h2 id="putus-judul" className="text-[18px] font-bold">Putuskan Gmail?</h2>
        <p className="mt-2 text-[14px] text-teks-redup">Akses dicabut di Google dan polling berhenti. Transaksi yang sudah masuk tetap tersimpan.</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="sekunder" autoFocus onClick={() => dlg.current?.close()}>Batal</Button>
          <Button variant="bahaya" disabled={pending} onClick={() => start(async () => {
            const r = await fetch("/api/gmail/disconnect", { method: "POST" }).catch(() => null);
            dlg.current?.close();
            if (!r?.ok) return toast({ text: "Belum bisa memutuskan. Periksa koneksi lalu coba lagi.", tone: "galat" });
            toast({ text: "Gmail diputuskan." });
            router.refresh();
          })}>Putuskan Gmail</Button>
        </div>
      </dialog>
    </>
  );
}
