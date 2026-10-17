import { notFound } from "next/navigation";
import { rl101 } from "@openstudy/shared";
import { LessonView } from "./LessonView";

const FIXTURES = { rl101 } as const;

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fixture = FIXTURES[id as keyof typeof FIXTURES];
  if (!fixture) notFound();
  return <LessonView fixture={fixture} />;
}
