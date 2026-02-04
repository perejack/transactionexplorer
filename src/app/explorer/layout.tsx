import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explorer • Transactions Explorer",
};

export default function ExplorerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
