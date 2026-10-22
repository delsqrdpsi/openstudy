import { goOnRequest, paceRequest, pauseRequest } from "./intent";

describe("paceRequest", () => {
  it("hears a request to slow down", () => {
    for (const t of ["slow down", "Slow down please.", "slower", "that's too fast", "can you go slower?", "not so fast", "take it slow"]) expect(paceRequest(t), t).toBe("slow");
  });
  it("hears a request to speed back up", () => {
    for (const t of ["faster", "speed up", "you can go faster now", "normal speed please", "too slow", "pick up the pace"]) expect(paceRequest(t), t).toBe("normal");
  });
  it("leaves real messages to the tutor", () => {
    for (const t of ["", "wait, what is a reward?", "why does the slower car win the race in the example you gave earlier?", "is the fast one the agent?", "slow"]) expect(paceRequest(t), t).toBeNull();
  });
});

describe("pauseRequest", () => {
  it("hears pause words and slow-down requests", () => {
    for (const t of ["wait", "Wait!", "hold on", "hang on a sec", "pause", "stop", "one sec", "give me a moment", "just a minute", "slow down", "too fast"]) expect(pauseRequest(t), t).toBe(true);
  });
  it("does not pause on a question that starts with wait", () => {
    for (const t of ["wait, what does that mean?", "stop the car example and show me the math", "hold on, which one is the state?", "ok"]) expect(pauseRequest(t), t).toBe(false);
  });
});

describe("goOnRequest", () => {
  it("hears the go-ahead", () => {
    for (const t of ["ok", "okay", "go on", "Go on.", "ok go on", "yes", "next", "continue", "carry on", "alright, keep going", "got it", "ready", "sure go ahead", "play"]) expect(goOnRequest(t), t).toBe(true);
  });
  it("sends anything with content to the tutor", () => {
    for (const t of ["", "ok but why?", "yes it is the reward", "next question", "go on about the state", "continue with the math please"]) expect(goOnRequest(t), t).toBe(false);
  });
});
