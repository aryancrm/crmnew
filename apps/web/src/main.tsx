import { MedicineRequestsPage } from "./inventory/requests";
import "@fontsource-variable/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AdminChannelPage, AdminChannelsPage } from "./pages/admin-channels";
import { AttendanceMonthPage, AttendancePage } from "./pages/attendance";
import { AttendanceReportPage } from "./pages/attendance-report";
import { ChangePassword } from "./pages/change-password";
import { ChannelsPage } from "./pages/channels";
import { Customer } from "./pages/customer";
import { Customers } from "./pages/customers";
import { FieldCalendarPage } from "./pages/field-calendar";
import { FieldExpensesPage } from "./pages/field-expenses";
import { FieldLivePage } from "./pages/field-live";
import { FieldReportPage } from "./pages/field-report";
import { Home } from "./pages/home";
import { HrPeoplePage, HrPersonPage } from "./pages/hr-people";
import { InboxPage } from "./pages/inbox";
import { Inventory } from "./pages/inventory";
import { InventoryOverview } from "./pages/inventory-overview";
import { Invoice, Invoices } from "./pages/invoices";
import { LeadPage } from "./pages/lead";
import { LeadsDesk } from "./pages/leads";
import { LeaveListPage } from "./pages/leave-list";
import { Login } from "./pages/login";
import { Medicine } from "./pages/medicine";
import { Medicines } from "./pages/medicines";
import { MessagesPage } from "./pages/messages";
import { Payments, Refunds } from "./pages/money";
import { Moves } from "./pages/moves";
import { MyConfirmations } from "./pages/my-confirmations";
import { MyLeavePage } from "./pages/my-leave";
import { MyPayslipsPage } from "./pages/my-payslips";
import { MyTeamPage, TeamSeatPage } from "./pages/my-team";
import { NotBuilt } from "./pages/not-built";
import { Order } from "./pages/order";
import { OrderNew } from "./pages/order-new";
import { Orders } from "./pages/orders";
import { OrdersToCheck } from "./pages/orders-board";
import { OrgPage } from "./pages/org";
import { OrgChartPage } from "./pages/org-chart";
import { OwedReport } from "./pages/owed";
import { PayRatesPage, PayrollMonthPage, PayrollPage } from "./pages/payroll";
import { PointsAccountPage, PointsPage } from "./pages/points";
import { Purchase } from "./pages/purchase";
import { Purchases } from "./pages/purchases";
import { ChannelsReport, Reports } from "./pages/reports";
import { SalesOrderPage } from "./pages/sales-order";
import { SettingsPage } from "./pages/settings";
import { DeliveryReceipt, Shipments } from "./pages/shipments";
import { SpeedPage } from "./pages/speed";
import { StatementPage } from "./pages/statement";
import { Suppliers } from "./pages/suppliers";
import { Targets } from "./pages/targets";
import { TeamSalesPage } from "./pages/team";
import { VisitPlanPage } from "./pages/visit-plan";
import { VisitsPage } from "./pages/visits";
import { Shell } from "./shell";
import "./styles.css";

const queries = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 15_000 } },
});

const root = document.getElementById("root");
if (!root) throw new Error("No #root element.");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="password" element={<ChangePassword />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="medicines" element={<Medicines />} />
            <Route path="medicines/:id" element={<Medicine />} />
            <Route path="hospitals" element={<Customers key="hospital" kind="hospital" />} />
            <Route path="doctors" element={<Customers key="doctor" kind="doctor" />} />
            <Route path="patients" element={<Customers key="patient" kind="patient" />} />
            <Route path="customers" element={<Customers key="all" />} />
            <Route path="customers/:id" element={<Customer />} />
            <Route path="customers/:id/statement" element={<StatementPage />} />
            <Route path="my/area" element={<Customers key="mine" mine />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="channels" element={<ChannelsPage />} />
            <Route path="points" element={<PointsPage />} />
            <Route path="points/:id" element={<PointsAccountPage key="points" />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="leads" element={<LeadsDesk />} />
            <Route path="leads/:id" element={<LeadPage key="lead" />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/new" element={<OrderNew />} />
            <Route path="orders/:id/fix" element={<OrderNew key="fix" fix />} />
            <Route path="orders/:id/change" element={<OrderNew key="change" change />} />
            <Route path="orders/:id/sales-order" element={<SalesOrderPage />} />
            <Route path="orders/:id" element={<Order />} />
            <Route path="orders/check" element={<OrdersToCheck key="needs" />} />
            <Route path="on-hold" element={<OrdersToCheck key="hold" defaultTab="hold" />} />
            <Route
              path="orders/sent-back"
              element={<OrdersToCheck key="sent" defaultTab="sent" />}
            />
            <Route path="finance" element={<OrdersToCheck key="finance" desk="finance" />} />
            <Route path="dispatch" element={<OrdersToCheck key="dispatch" desk="dispatch" />} />
            <Route
              path="dispatch/hold"
              element={<OrdersToCheck key="dispatch-hold" desk="dispatch" defaultTab="hold" />}
            />
            <Route path="shipments" element={<Shipments />} />
            <Route path="orders/:id/receipt" element={<DeliveryReceipt />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/:id" element={<Invoice />} />
            <Route path="payments" element={<Payments />} />
            <Route path="owed" element={<OwedReport />} />
            <Route path="refunds" element={<Refunds />} />
            <Route path="finance/mine" element={<MyConfirmations />} />
            <Route path="inventory/overview" element={<InventoryOverview />} />
            <Route path="inventory/requests" element={<MedicineRequestsPage />} />
            <Route path="targets" element={<Targets />} />
            <Route path="team" element={<TeamSalesPage />} />
            <Route path="company" element={<OrgChartPage />} />
            <Route path="people" element={<OrgPage />} />
            <Route path="hr/people" element={<HrPeoplePage />} />
            <Route path="hr/people/:id" element={<HrPersonPage key="person" />} />
            <Route path="hr/attendance" element={<AttendancePage />} />
            <Route path="hr/report" element={<AttendanceReportPage />} />
            <Route path="hr/leave" element={<LeaveListPage />} />
            <Route path="me/leave" element={<MyLeavePage />} />
            <Route path="me/payslips" element={<MyPayslipsPage />} />
            <Route path="me/payslips/:month" element={<MyPayslipsPage />} />
            <Route path="hr/payroll" element={<PayrollPage />} />
            <Route path="hr/payroll/rates" element={<PayRatesPage />} />
            <Route path="hr/payroll/:month" element={<PayrollMonthPage key="month" />} />
            <Route path="visits" element={<VisitsPage />} />
            <Route path="visits/plan" element={<VisitPlanPage />} />
            <Route path="visits/calendar" element={<FieldCalendarPage />} />
            <Route path="field/live" element={<FieldLivePage />} />
            <Route path="visits/expenses" element={<FieldExpensesPage />} />
            <Route path="field/report" element={<FieldReportPage />} />
            <Route path="hr/attendance/:id" element={<AttendanceMonthPage key="month" />} />
            <Route path="admin/channels" element={<AdminChannelsPage />} />
            <Route path="admin/channels/:id" element={<AdminChannelPage />} />
            <Route path="my-team" element={<MyTeamPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="speed" element={<SpeedPage />} />
            <Route path="messages/:id" element={<MessagesPage />} />
            <Route path="my-team/seat/:id" element={<TeamSeatPage />} />
            <Route path="reports" element={<Reports />} />
            <Route path="reports/channels" element={<ChannelsReport />} />
            <Route path="adjustments" element={<Moves key="adjust" kind="adjust" />} />
            <Route path="transfers" element={<Moves key="transfer" kind="transfer" />} />
            <Route path="receives" element={<Moves key="receive" kind="receive" />} />
            <Route path="purchases" element={<Purchases />} />
            <Route path="purchases/:id" element={<Purchase />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="*" element={<NotBuilt />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
