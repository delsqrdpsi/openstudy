import { Suspense } from "react";
import { LiveView } from "./LiveView";

export default function LivePage() {
  return (
    <Suspense>
      <LiveView />
    </Suspense>
  );
}
