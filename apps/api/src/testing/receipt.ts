// For the tests: the photo of a signed delivery receipt put on an order, as Dispatch (or the
// case's agent) does before marking it delivered.

type Requester = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);

/** Attaches a signed receipt (DR) to the order; answers the upload's status. */
export async function attachReceipt(app: Requester, cookie: string, orderId: number) {
  const form = new FormData();
  form.set("kind", "dr");
  form.set("file", new File([PNG], "signed-dr.png", { type: "image/png" }));
  const response = await app.request(`/api/orders/${orderId}/papers`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  return response.status;
}
