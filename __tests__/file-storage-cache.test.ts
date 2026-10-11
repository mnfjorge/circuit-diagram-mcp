const getMock = jest.fn();

jest.mock("@vercel/blob", () => ({
  get: (...args: unknown[]) => getMock(...args),
  put: jest.fn(),
  del: jest.fn(),
  list: jest.fn(),
}));

import { downloadFile } from "../lib/file-storage";

describe("downloadFile (Vercel Blob)", () => {
  beforeEach(() => {
    delete process.env.USE_LOCAL_FILE_STORAGE;
    getMock.mockReset();
    getMock.mockResolvedValue({ statusCode: 200, stream: new Response("{}").body });
  });

  test("bypasses the CDN cache, so a just-overwritten file is never read back stale", async () => {
    await downloadFile("diagrams/x.json");
    expect(getMock).toHaveBeenCalledWith("diagrams/x.json", expect.objectContaining({ useCache: false }));
  });
});
