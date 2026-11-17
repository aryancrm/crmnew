import { MedicineRequestsPage } from "./inventory/requests";
import "@fontsource/poppins/300.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import { ApiFailure } from "./api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminChannelPage, AdminChannelsPage } from "./pages/admin-channels";
import { AdminDataChecks } from "./pages/admin-data-checks";
import { AdminCompanyChartPage } from "./pages/admin-company-chart";
import { AdminZohoSellers } from "./pages/admin-zoho-sellers";
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
import { CompanyMapPage } from "./pages/company-map";
import { MyTeamPage, TeamSeatPage } from "./pages/my-team";
import { SalesTreePage } from "./pages/sales-tree";
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
import { Returns } from "./pages/returns";
import { SalesOrderPage } from "./pages/sales-order";
import { SettingsPage } from "./pages/settings";
import { AddressSlip, DeliveryReceipt, Shipments } from "./pages/shipments";
import { SpeedPage } from "./pages/speed";
import { StatementPage } from "./pages/statement";
import { Suppliers } from "./pages/suppliers";
import { MyScorePage } from "./pages/my-score";
import { TeamScoresPage } from "./pages/team-scores";
import { CollectionsPage } from "./pages/collections";
import { HuddlePage } from "./pages/huddle";
import { AccountsPage, B2bTeamPage, ProspectsPage } from "./pages/b2b";
import { CareGroupsPage } from "./pages/care-groups";
import { MtListingsPage } from "./pages/mt";
import { WorkLogPage, WorkLogsPage } from "./pages/work-log";
import { PipelinePage, RegistrationsPage, RegulatoryReportPage } from "./pages/regulatory";
import { BooksShell } from "./books/shell";
import { BookListPage } from "./books/list";
import { VendorsPage } from "./books/vendors";
import { CustomersPage } from "./books/customers";
import { ItemsPage, PriceListsPage } from "./books/items";
import { AccountsPage as ChartOfAccountsPage, BankingPage } from "./books/accounts";
import { ReportsPage } from "./books/reports";
import { DecisionsPage } from "./pages/decisions";
import { AuditPage } from "./pages/audit";
import { BatchTracePage } from "./pages/batch-trace";
import { CustomersImportPage } from "./pages/customers-import";
import { BillFromOrderPage, NewBillPage, NewPaymentPage, NewReceiptPage, NewPurchaseOrderPage, NewVendorCreditPage, NewVendorPage, ReceivePage } from "./books/forms";
import { CompanyPapersPage, TenderPage, TendersPage } from "./pages/tenders";
import { ClidpListingsPage, ClidpTeamPage } from "./pages/clidp";
import { RxDoctorsPage, RxFieldPage } from "./pages/rx";
import { Targets } from "./pages/targets";
import { ToCallPage } from "./pages/to-call";
import { TeamSalesPage } from "./pages/team";
import { VisitPlanPage } from "./pages/visit-plan";
import { VisitsPage } from "./pages/visits";
import { Shell } from "./shell";
import "./styles.css";

const queries = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 15_000,
      // A refusal (not allowed, not found, wrong input) won't change on asking again: say it at once.
      retry: (failures, error) =>
        !(error instanceof ApiFailure && error.status >= 400 && error.status < 500) && failures < 3,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("No #root element.");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Zoho Inventory's Sales and Purchases, in Zoho's own frame (docs/PLAN.md 17). */}
          <Route path="/books" element={<BooksShell />}>
            <Route index element={<Navigate to="/books/purchaseorders" replace />} />
            <Route path="vendors/new" element={<NewVendorPage />} />
            <Route path="purchaseorders/new" element={<NewPurchaseOrderPage />} />
            <Route path="purchaseorders/:id/receive" element={<ReceivePage />} />
            <Route path="purchaseorders/:id/bill" element={<BillFromOrderPage />} />
            <Route path="bills/new" element={<NewBillPage />} />
            <Route path="paymentsmade/new" element={<NewPaymentPage />} />
            <Route path="paymentsreceived/new" element={<NewReceiptPage />} />
            <Route path="vendorcredits/new" element={<NewVendorCreditPage />} />
            <Route path="items" element={<ItemsPage />} />
            <Route path="items/:id" element={<ItemsPage />} />
            <Route path="pricelists" element={<PriceListsPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomersPage />} />
            <Route path="vendors" element={<VendorsPage />} />
            <Route path="vendors/:id" element={<VendorsPage />} />
            <Route path="accounts" element={<ChartOfAccountsPage />} />
            <Route path="accounts/:id" element={<ChartOfAccountsPage />} />
            <Route path="banking" element={<BankingPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="reports/:report" element={<ReportsPage />} />
            <Route path=":list" element={<BookListPage />} />
            <Route path=":list/:id" element={<BookListPage />} />
          </Route>
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
            <Route path="pap" element={<LeadsDesk key="pap" desk="pap" />} />
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
            <Route path="orders/:id/address" element={<AddressSlip />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/:id" element={<Invoice />} />
            <Route path="payments" element={<Payments />} />
            <Route path="owed" element={<OwedReport />} />
            <Route path="refunds" element={<Refunds />} />
            <Route path="finance/mine" element={<MyConfirmations />} />
            <Route path="returns" element={<Returns />} />
            <Route path="decisions" element={<DecisionsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="inventory/trace" element={<BatchTracePage />} />
            <Route path="customers/import" element={<CustomersImportPage />} />
            <Route path="inventory/overview" element={<InventoryOverview />} />
            <Route path="inventory/requests" element={<MedicineRequestsPage />} />
            <Route path="targets" element={<Targets />} />
            <Route path="my/score" element={<MyScorePage />} />
            <Route path="to-call" element={<ToCallPage />} />
            <Route path="collections" element={<CollectionsPage />} />
            <Route path="huddle" element={<HuddlePage />} />
            <Route path="rx/doctors" element={<RxDoctorsPage />} />
            <Route path="rx/field" element={<RxFieldPage />} />
            <Route path="care-groups" element={<CareGroupsPage />} />
            <Route path="b2b/prospects" element={<ProspectsPage />} />
            <Route path="b2b/accounts" element={<AccountsPage />} />
            <Route path="b2b/team" element={<B2bTeamPage />} />
            <Route path="clidp/listings" element={<ClidpListingsPage />} />
            <Route path="tenders" element={<TendersPage />} />
            <Route path="tenders/:id" element={<TenderPage />} />
            <Route path="company-papers" element={<CompanyPapersPage />} />
            <Route path="mt/listings" element={<MtListingsPage />} />
            <Route path="work-log" element={<WorkLogPage />} />
            <Route path="work-logs" element={<WorkLogsPage />} />
            <Route path="regulatory/pipeline" element={<PipelinePage />} />
            <Route path="regulatory/registrations" element={<RegistrationsPage />} />
            <Route path="reports/regulatory" element={<RegulatoryReportPage />} />
            <Route path="clidp/team" element={<ClidpTeamPage />} />
            <Route path="team-scores" element={<TeamScoresPage />} />
            <Route path="team" element={<TeamSalesPage />} />
            <Route path="company" element={<OrgChartPage />} />
            <Route path="company/map" element={<CompanyMapPage />} />
            <Route path="company/sales" element={<SalesTreePage />} />
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
            <Route path="admin/data-checks" element={<AdminDataChecks />} />
            <Route path="admin/zoho-sellers" element={<AdminZohoSellers />} />
            <Route path="admin/company-chart" element={<AdminCompanyChartPage />} />
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
