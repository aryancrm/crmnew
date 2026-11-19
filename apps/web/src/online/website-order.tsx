// A website admin's "Open in the CRM" link (<CRM_APP_URL>/website-order?site=&ref=, as the old
// CRM had it): opens the case the website's order became, or its order.

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { PageState } from "../ui";

export function WebsiteOrderPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const site = params.get("site") ?? "";
  const ref = params.get("ref") ?? "";
  const query = useQuery({
    queryKey: ["website-order", site, ref],
    queryFn: () =>
      api<{ leadId: number | null; orderId: number | null }>(
        `/api/website-order?site=${encodeURIComponent(site)}&ref=${encodeURIComponent(ref)}`,
      ),
  });
  const found = query.data;
  useEffect(() => {
    if (!found) return;
    if (found.leadId) navigate(`/leads/${found.leadId}`, { replace: true });
    else if (found.orderId) navigate(`/orders/${found.orderId}`, { replace: true });
  }, [found, navigate]);
  return <PageState query={query} what={`website order ${ref}`} />;
}
