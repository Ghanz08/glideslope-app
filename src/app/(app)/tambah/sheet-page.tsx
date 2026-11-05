"use client";
import { useRouter } from "next/navigation";
import { AddSheet } from "@/components/add-sheet";

export function SheetPage() {
  const router = useRouter();
  return <AddSheet open onClose={() => router.push("/")} />;
}
