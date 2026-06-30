import type { Metadata } from "next";
import FAQPage from "@/components/FAQPage";

export const metadata: Metadata = {
  title: "FAQ — Aura Vault Protocol",
  description:
    "Frequently asked questions about Aura Vault Protocol: deposits, withdrawals, yield, security, and more.",
};

export default function FAQ() {
  return <FAQPage />;
}
