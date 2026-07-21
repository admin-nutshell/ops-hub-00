import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the shared Inngest client so triggerFixAuthor never makes a real
// network call — mirrors vulnDetect.test.ts's mock of the same client.
vi.mock("../../inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

import { inngest } from "../../inngest/client";
import {
  triggerFixAuthor,
  validateFixAuthorTriggerInput,
  FixAuthorDispatchError,
} from "../fixAuthor";
import { ValidationError } from "../settingsWrite";

const PRODUCT_ID = "8bafa6a6-4d80-4983-89bc-e536d3dba672";
const FINDING_ID = "44444444-4444-4444-4444-444444444444";

describe("validateFixAuthorTriggerInput", () => {
  it("accepts a valid findingId", () => {
    expect(validateFixAuthorTriggerInput({ findingId: FINDING_ID })).toEqual({
      findingId: FINDING_ID,
    });
  });

  it("rejects a non-object payload", () => {
    expect(() => validateFixAuthorTriggerInput("not an object")).toThrow(ValidationError);
    expect(() => validateFixAuthorTriggerInput(null)).toThrow(ValidationError);
    expect(() => validateFixAuthorTriggerInput([FINDING_ID])).toThrow(ValidationError);
  });

  it("rejects a missing findingId", () => {
    expect(() => validateFixAuthorTriggerInput({})).toThrow(/findingId must be a valid/);
  });

  it("rejects a findingId that isn't a uuid shape", () => {
    expect(() => validateFixAuthorTriggerInput({ findingId: "not-a-uuid" })).toThrow(
      /findingId must be a valid/
    );
    expect(() => validateFixAuthorTriggerInput({ findingId: "" })).toThrow(
      /findingId must be a valid/
    );
    expect(() => validateFixAuthorTriggerInput({ findingId: 123 })).toThrow(
      /findingId must be a valid/
    );
  });
});

describe("triggerFixAuthor", () => {
  beforeEach(() => {
    vi.mocked(inngest.send).mockReset();
  });

  it("sends ops-hub/fix.author.requested with the product id and finding id, returns dispatched:true", async () => {
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["evt-1"] } as never);
    await expect(triggerFixAuthor(PRODUCT_ID, FINDING_ID)).resolves.toEqual({ dispatched: true });
    expect(inngest.send).toHaveBeenCalledWith({
      name: "ops-hub/fix.author.requested",
      data: { product_id: PRODUCT_ID, finding_id: FINDING_ID },
    });
  });

  it("wraps an inngest.send failure (e.g. missing INNGEST_EVENT_KEY) as a 503 FixAuthorDispatchError, not a raw crash", async () => {
    vi.mocked(inngest.send).mockRejectedValue(new Error("Event key not found"));
    await expect(triggerFixAuthor(PRODUCT_ID, FINDING_ID)).rejects.toThrow(FixAuthorDispatchError);
    try {
      await triggerFixAuthor(PRODUCT_ID, FINDING_ID);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FixAuthorDispatchError);
      expect((err as FixAuthorDispatchError).httpStatus).toBe(503);
      expect((err as FixAuthorDispatchError).message).toContain("Event key not found");
    }
  });
});
