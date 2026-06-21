import { inngest } from "./client";

export const helloWorld = inngest.createFunction(
  { id: "hello-world", triggers: [{ event: "test/hello.world" }] },
  async ({ event }) => {
    return { message: "Hello from ops-hub!", received: event.data };
  }
);
