import { BottomNav, Sidebar } from "@/components/nav";
import { LockBoundary, LockScreen } from "@/components/lock";
import { Toaster } from "@/components/toast";
import { requireOwner } from "@/lib/server/owner";
import { inboxCount } from "@/lib/server/queries";
import { APP_NAME } from "@/lib/env";
import { privacyOn } from "@/lib/server/privacy";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const gate = await requireOwner({ allowOnboarding: true });
  // S-02: when locked, financial content is never rendered
  if (gate.state === "locked") return <LockScreen />;
  const [count, hidden] = await Promise.all([inboxCount(gate.supabase), privacyOn()]);
  const content = (
    <>
      <Sidebar appName={APP_NAME} inboxCount={count} />
      <div className="lg:pl-[248px]" data-privasi={hidden ? "on" : "off"}>
        <main id="isi" className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-28 lg:max-w-[1320px] lg:px-10 lg:pt-10 lg:pb-12">
          {children}
        </main>
      </div>
      <BottomNav inboxCount={count} />
      <Toaster />
    </>
  );
  return gate.settings.pin_enabled ? <LockBoundary minutes={gate.settings.idle_timeout_minutes}>{content}</LockBoundary> : content;
}
