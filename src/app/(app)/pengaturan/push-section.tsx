"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePushPrefs, subscribePush, unsubscribePush } from "@/app/actions/push";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";

const KINDS = [["inbox", "Item Inbox baru (maks 1 per 15 menit)"], ["gmail", "Gmail perlu dihubungkan ulang"], ["deposito", "Deposito jatuh tempo dalam 7 hari"]] as const;
const b64 = (b: ArrayBuffer | null) => (b ? btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "");

export function PushSection({ prefs, vapidKey }: { prefs: Record<string, boolean>; vapidKey: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<"memuat" | "tidak_didukung" | "ios_pasang" | "ditolak" | "mati" | "aktif">("memuat");
  const [pending, start] = useTransition();

  useEffect(() => {
    void (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidKey) return setState(ios && !standalone ? "ios_pasang" : "tidak_didukung");
      if (ios && !standalone) return setState("ios_pasang");
      if (Notification.permission === "denied") return setState("ditolak");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "aktif" : "mati");
    })();
  }, [vapidKey]);

  const enable = () =>
    start(async () => {
      if ((await Notification.requestPermission()) !== "granted") return setState("ditolak");
      const reg = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(vapidKey!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const r = await subscribePush({ endpoint: sub.endpoint, p256dh: b64(sub.getKey("p256dh")), auth: b64(sub.getKey("auth")) });
      if ("error" in r) return toast({ text: r.error.message, tone: "galat" });
      setState("aktif");
      toast({ text: "Notifikasi aktif." });
    });
  const disable = () =>
    start(async () => {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("mati");
    });

  return (
    <div className="flex flex-col gap-3 text-[14px]">
      {state === "ios_pasang" && <p className="text-teks-redup">Di iPhone, pasang aplikasi ke layar utama dulu (Bagikan → Tambahkan ke Layar Utama), lalu buka dari ikonnya untuk menyalakan notifikasi.</p>}
      {state === "ditolak" && <p className="text-teks-redup">Izin notifikasi ditolak peramban. Aktifkan lewat pengaturan situs di peramban, lalu muat ulang halaman ini.</p>}
      {state === "tidak_didukung" && <p className="text-teks-redup">Notifikasi belum tersedia di peramban ini{vapidKey ? "" : " atau kunci VAPID belum diisi"}.</p>}
      {state === "mati" && <Button variant="lembut" disabled={pending} onClick={enable}>Nyalakan notifikasi</Button>}
      {state === "aktif" && <Button variant="sekunder" disabled={pending} onClick={disable}>Matikan notifikasi di perangkat ini</Button>}
      <fieldset className="flex flex-col">
        <legend className="mb-1 font-semibold text-teks-redup">Jenis notifikasi</legend>
        {KINDS.map(([k, label]) => (
          <label key={k} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" defaultChecked={prefs[k] !== false} className="h-5 w-5 accent-aksen"
              onChange={(e) => start(async () => { await savePushPrefs({ inbox: prefs.inbox !== false, gmail: prefs.gmail !== false, deposito: prefs.deposito !== false, [k]: e.target.checked }); router.refresh(); })} />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="text-[12px] text-teks-pelan">Isi notifikasi tidak memuat nominal atau nama merchant.</p>
    </div>
  );
}
