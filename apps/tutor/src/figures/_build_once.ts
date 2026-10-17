import { startBuild } from "./builder";
const job = startBuild({
  name: "lever-balance",
  concept: "A first-class lever on a fulcrum: two pans, a sliding weight, and a readout of torque on each side; the beam tips until the torques balance. Shows moment = force times distance.",
  onDone: (j) => {
    console.log("DONE", JSON.stringify({ status: j.status, error: j.error, figure: j.figure?.name, minutes: ((j.finishedAt! - j.startedAt) / 60000).toFixed(1) }));
    process.exit(0);
  },
});
console.log("started", job.id);
