import { MedicineRequestsPage } from "./inventory/requests";
import "@fontsource/poppins/300.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import { ApiFailure } from "./api";
import { placesOrders, readsOnlineDesk } from "./auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { Analytics } from "@vercel/analytics/react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminChannelPage, AdminChannelsPage } from "./admin/channels";
import { AdminDataChecks } from "./admin/data-checks";
import { AdminCompanyChartPage } from "./admin/company-chart-page";
import { AdminZohoSellers } from "./admin/zoho-sellers";
import { AttendanceMonthPage, AttendancePage } from "./hr/attendance";
import { AttendanceReportPage } from "./hr/attendance-report";
import { ChangePassword } from "./account/change-password";
import { ChannelsPage } from "./online/channels";
import { Customer } from "./customers/customer";
import { Customers } from "./customers/customers";
import { FieldCalendarPage } from "./field/calendar";
import { FieldLivePage } from "./field/live";
import { FieldReportPage } from "./field/report";
import { Home } from "./home/home";
import { HrPeoplePage, HrPersonPage } from "./hr/people";
import { InboxPage } from "./online/inbox";
import { Inventory } from "./inventory/inventory";
import { InventoryOverview } from "./inventory/overview";
import { Invoice, Invoices } from "./finance/invoices";
import { LeadPage } from "./online/lead";
import { WebsiteOrderPage } from "./online/website-order";
import { LeadsDesk } from "./online/leads";
import { LeaveListPage } from "./hr/leave-list";
import { Login } from "./account/login";
import { Medicine } from "./inventory/medicine";
import { Medicines } from "./inventory/medicines";
import { MessagesPage } from "./messages/messages";
import { Payments, Refunds } from "./finance/money";
import { Moves } from "./inventory/moves";
import { MyConfirmations } from "./finance/my-confirmations";
import { MyLeavePage } from "./hr/my-leave";
import { MyPayslipsPage } from "./hr/my-payslips";
import { CompanyMapPage } from "./company/map";
import { MyTeamPage, TeamSeatPage } from "./team/my-team";
import { SalesTreePage } from "./company/sales-tree";
import { DivisionsPage } from "./company/divisions";
import { StockReportPage } from "./inventory/stock-report";
import { NotBuilt, OnlyFor } from "./home/not-built";
import { Order } from "./orders/order";
import { OrderNew } from "./orders/order-new";
import { Orders } from "./orders/orders";
import { OrdersToCheck } from "./orders/board";
import { OrgPage } from "./org/teams";
import { OrgChartPage } from "./org/chart-page";
import { OwedReport } from "./finance/owed";
import { CollectPage } from "./finance/collect";
import { DeskPersonPage } from "./desk/person";
import { DeskReportPage } from "./desk/report";
import { PayRatesPage, PayrollMonthPage, PayrollPage } from "./hr/payroll";
import { PointsAccountPage, PointsPage } from "./customers/points";
import { Purchase } from "./buying/purchase";
import { Purchases } from "./buying/purchases";
import { PurchasesBoard } from "./buying/board";
import { ZohoReportsPage } from "./company/zoho-reports";
import { KeyReportPage } from "./company/key-report";
import { TargetSheetPage } from "./company/target-sheet";
import { DocListPage, DocPage, NewBillOrCredit, NewVendorPayment } from "./buying/docs";
import { NewPurchaseOrder, PurchaseOrderPage, PurchaseOrdersPage } from "./buying/orders";
import { VendorPage as BuyingVendor, VendorsPage as BuyingVendors } from "./buying/vendors";
import { ChannelsReport, Reports } from "./company/reports";
import { CustomReportPage } from "./company/custom-report";
import { Returns } from "./orders/all-returns";
import { SalesOrderPage } from "./orders/sales-order";
import { CustomerPoPage } from "./orders/purchase-order";
import { SettingsPage } from "./admin/settings";
import { AddressSlip, DeliveryReceipt, Shipments } from "./dispatch/shipments";
import { SpeedPage } from "./desk/speed";
import { StatementPage } from "./finance/statement";
import { Suppliers } from "./buying/suppliers";
import { MyScorePage } from "./sellers/my-score";
import { TeamScoresPage } from "./team/team-scores";
import { CollectionsPage } from "./sellers/collections";
import { HuddlePage } from "./sellers/huddle";
import { AccountsPage, B2bTeamPage, ProspectsPage } from "./sellers/b2b";
import { CareGroupsPage } from "./sellers/care-groups";
import { MtChainsPage, MtListingsPage } from "./sellers/mt";
import { WorkLogPage, WorkLogsPage } from "./hr/work-log";
import { PipelinePage, RegistrationsPage, RegulatoryReportPage } from "./regulatory/regulatory";
import { BooksIndex, BooksShell, InBooks } from "./books/shell";
import { BookListPage } from "./books/list";
import { VendorsPage } from "./books/vendors";
import { CustomersPage } from "./books/customers";
import { ItemsPage, PriceListsPage } from "./books/items";
import { AccountsPage as ChartOfAccountsPage, BankingPage } from "./books/accounts";
import { ReportsPage } from "./books/reports";
import { DecisionsPage } from "./messages/decisions";
import { AuditPage } from "./admin/audit";
import { BatchTracePage } from "./inventory/batch-trace";
import { CustomersImportPage } from "./customers/spreadsheet";
import { MySamplesPage, TeamSamplesPage } from "./inventory/samples";
import { ComplaintsPage } from "./regulatory/complaints";
import { BillFromOrderPage, NewBillPage, NewPaymentPage, NewReceiptPage, NewPurchaseOrderPage, NewVendorCreditPage, NewVendorPage, ReceivePage } from "./books/forms";
import { BankStatementPage, ReconcilePage } from "./books/bank";
import { BooksHome } from "./books/home";
import { LockingPage, NewCreditNotePage, NewDepositPage, NewExpensePage, NewJournalPage, NewTransferPage } from "./books/ledger";
import { BidReportPage } from "./sellers/bid-report";
import { CompanyPapersPage, TenderPage, TendersPage } from "./sellers/tenders";
import { ClidpListingsPage, ClidpTeamPage } from "./sellers/clidp";
import { ClidpRoadPage } from "./sellers/clidp-road";
import { HospitalsPage } from "./sellers/hospitals";
import { RxBusinessPage } from "./sellers/rx-business";
import { RxDoctorsPage, RxFieldPage } from "./sellers/rx";
import { Targets } from "./team/targets";
import { Calls } from "./sellers/calls";
import { SalesPerformancePage } from "./company/sales-performance";
import { ToCallPage } from "./customers/to-call";
import { TeamSalesPage } from "./team/team";
import { VisitPlanPage } from "./field/visit-plan";
import { MrClientPage, MrClientsPage } from "./mr/clients";
import { MrDayReportPage } from "./mr/day-report";
import { MrExpensesPage } from "./mr/expenses";
import { MrHomePage } from "./mr/home";
import { MrMapPage } from "./mr/map";
import { MrPlanPage } from "./mr/plan";
import { MrFollowUpsPage, MrHolidaysPage, MrReportsPage } from "./mr/reports";
import { MrVisitPage } from "./mr/visit";
import { MrVisitsPage } from "./mr/visits";
import { TeamHome as FieldTeamPage } from "./mr/team";
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
    {/* Vercel Web Analytics: page views and visitors, on the live site only (Aryan, 20 Nov). */}
    <Analytics />
    <QueryClientProvider client={queries}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Zoho Inventory's Sales and Purchases, in Zoho's own frame (docs/PLAN.md 17). */}
          <Route path="/books" element={<BooksShell />}>
            <Route index element={<BooksIndex />} />
            <Route path="home" element={<BooksHome />} />
            <Route path="finance/checks" element={<InBooks><OrdersToCheck key="books-finance" desk="finance" /></InBooks>} />
            <Route path="finance/owed" element={<InBooks><OwedReport /></InBooks>} />
            <Route path="finance/invoices" element={<InBooks><Invoices /></InBooks>} />
            <Route path="finance/payments" element={<InBooks><Payments /></InBooks>} />
            <Route path="finance/refunds" element={<InBooks><Refunds /></InBooks>} />
            <Route path="finance/returns" element={<InBooks><Returns /></InBooks>} />
            <Route path="vendors/new" element={<NewVendorPage />} />
            <Route path="purchaseorders/new" element={<NewPurchaseOrderPage />} />
            <Route path="purchaseorders/:id/receive" element={<ReceivePage />} />
            <Route path="purchaseorders/:id/bill" element={<BillFromOrderPage />} />
            <Route path="bills/new" element={<NewBillPage />} />
            <Route path="paymentsmade/new" element={<NewPaymentPage />} />
            <Route path="paymentsreceived/new" element={<NewReceiptPage />} />
            <Route path="vendorcredits/new" element={<NewVendorCreditPage />} />
            <Route path="expenses/new" element={<NewExpensePage />} />
            <Route path="journals/new" element={<NewJournalPage />} />
            <Route path="transfers/new" element={<NewTransferPage />} />
            <Route path="deposits/new" element={<NewDepositPage />} />
            <Route path="creditnotes/new" element={<NewCreditNotePage />} />
            <Route path="locking" element={<LockingPage />} />
            <Route path="bankstatement" element={<BankStatementPage />} />
            <Route path="reconcile" element={<ReconcilePage />} />
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
            <Route path="inbox" element={<OnlyFor allow={readsOnlineDesk}><InboxPage /></OnlyFor>} />
            <Route path="channels" element={<ChannelsPage />} />
            <Route path="points" element={<PointsPage />} />
            <Route path="points/:id" element={<PointsAccountPage key="points" />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="leads" element={<OnlyFor allow={readsOnlineDesk}><LeadsDesk /></OnlyFor>} />
            <Route path="pap" element={<LeadsDesk key="pap" desk="pap" />} />
            <Route path="leads/:id" element={<LeadPage key="lead" />} />
            <Route path="website-order" element={<WebsiteOrderPage />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/new" element={<OnlyFor allow={placesOrders}><OrderNew /></OnlyFor>} />
            <Route path="orders/:id/fix" element={<OrderNew key="fix" fix />} />
            <Route path="orders/:id/change" element={<OrderNew key="change" change />} />
            <Route path="orders/:id/sales-order" element={<SalesOrderPage />} />
            <Route path="orders/:id/purchase-order" element={<CustomerPoPage />} />
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
            <Route path="collect" element={<CollectPage />} />
            <Route path="desk/team" element={<DeskReportPage />} />
            <Route path="desk/person/:id" element={<DeskPersonPage />} />
            <Route path="finance/prepaid" element={<OrdersToCheck key="prepaid" desk="finance" terms="advance" title="Prepaid orders" />} />
            <Route path="refunds" element={<Refunds />} />
            <Route path="finance/mine" element={<MyConfirmations />} />
            <Route path="returns" element={<Returns />} />
            <Route path="decisions" element={<DecisionsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="inventory/trace" element={<BatchTracePage />} />
            <Route path="customers/import" element={<CustomersImportPage />} />
            <Route path="me/samples" element={<MySamplesPage />} />
            <Route path="field/samples" element={<TeamSamplesPage />} />
            <Route path="complaints" element={<ComplaintsPage />} />
            <Route path="inventory/overview" element={<InventoryOverview />} />
            <Route path="inventory/requests" element={<MedicineRequestsPage />} />
            <Route path="targets" element={<Targets />} />
            <Route path="calls" element={<Calls />} />
            <Route path="sales-performance" element={<SalesPerformancePage />} />
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
            <Route path="clidp/road" element={<ClidpRoadPage />} />
            <Route path="hospital-board" element={<HospitalsPage />} />
            <Route path="rx/business" element={<RxBusinessPage />} />
            <Route path="tenders" element={<TendersPage />} />
            <Route path="tenders/report" element={<BidReportPage />} />
            <Route path="tenders/:id" element={<TenderPage />} />
            <Route path="company-papers" element={<CompanyPapersPage />} />
            <Route path="mt/chains" element={<MtChainsPage />} />
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
            <Route path="divisions" element={<DivisionsPage />} />
            <Route path="inventory/stock-report" element={<StockReportPage />} />
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
            {/* The field (SEFMED's work in the MedRep's pages, docs/PLAN.md 22). */}
            <Route path="visits" element={<MrVisitsPage />} />
            <Route path="visits/:id" element={<MrVisitPage key="visit" />} />
            <Route path="visits/plan" element={<VisitPlanPage />} />
            <Route path="visits/calendar" element={<FieldCalendarPage />} />
            <Route path="visits/expenses" element={<MrExpensesPage />} />
            <Route path="field" element={<MrHomePage />} />
            <Route path="field/team" element={<FieldTeamPage />} />
            <Route path="field/plan" element={<MrPlanPage />} />
            <Route path="field/clients" element={<MrClientsPage />} />
            <Route path="field/clients/:id" element={<MrClientPage key="client" />} />
            <Route path="field/day-report" element={<MrDayReportPage />} />
            <Route path="field/reports" element={<MrReportsPage />} />
            <Route path="field/follow-ups" element={<MrFollowUpsPage />} />
            <Route path="field/holidays" element={<MrHolidaysPage />} />
            <Route path="field/map" element={<MrMapPage />} />
            <Route path="field/live" element={<FieldLivePage />} />
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
            <Route path="custom-report" element={<CustomReportPage />} />
            <Route path="reports" element={<Reports />} />
            <Route path="reports/channels" element={<ChannelsReport />} />
            <Route path="adjustments" element={<Moves key="adjust" kind="adjust" />} />
            <Route path="transfers" element={<Moves key="transfer" kind="transfer" />} />
            <Route path="receives" element={<Moves key="receive" kind="receive" />} />
            {/* One road for buying (Aryan, 18 Nov): Purchases (vendors, purchase orders, receives,
                bills, payments, vendor credits), which hold Zoho's history too. The first purchase
                pages' few orders still open by their number. */}
            {/* The CEO's key reports, in the CRM's frame (the books' report page). */}
            <Route path="key-reports/target-sheet" element={<TargetSheetPage />} />
            <Route path="key-reports/:report" element={<KeyReportPage />} />
            <Route path="zoho-reports" element={<ZohoReportsPage />} />
            <Route path="zoho-reports/:group" element={<ZohoReportsPage />} />
            <Route path="purchases" element={<PurchasesBoard />} />
            <Route path="purchases/new" element={<Navigate to="/purchases/orders/new" replace />} />
            <Route path="purchases/orders" element={<PurchaseOrdersPage />} />
            <Route path="purchases/orders/new" element={<NewPurchaseOrder />} />
            <Route path="purchases/orders/:id" element={<PurchaseOrderPage />} />
            <Route path="purchases/vendors" element={<BuyingVendors />} />
            <Route path="purchases/vendors/:id" element={<BuyingVendor />} />
            <Route path="purchases/receives" element={<DocListPage key="purchase_receive" kind="purchase_receive" />} />
            <Route path="purchases/receives/:id" element={<DocPage key="purchase_receive" kind="purchase_receive" />} />
            <Route path="purchases/bills" element={<DocListPage key="bill" kind="bill" />} />
            <Route path="purchases/bills/new" element={<NewBillOrCredit key="bill" kind="bill" />} />
            <Route path="purchases/bills/:id" element={<DocPage key="bill" kind="bill" />} />
            <Route path="purchases/payments" element={<DocListPage key="vendor_payment" kind="vendor_payment" />} />
            <Route path="purchases/payments/new" element={<NewVendorPayment />} />
            <Route path="purchases/payments/:id" element={<DocPage key="vendor_payment" kind="vendor_payment" />} />
            <Route path="purchases/credits" element={<DocListPage key="vendor_credit" kind="vendor_credit" />} />
            <Route path="purchases/credits/new" element={<NewBillOrCredit key="vendor_credit" kind="vendor_credit" />} />
            <Route path="purchases/credits/:id" element={<DocPage key="vendor_credit" kind="vendor_credit" />} />
            <Route path="purchases/old" element={<Purchases />} />
            <Route path="purchases/:id" element={<Purchase />} />
            <Route path="suppliers" element={<Navigate to="/purchases/vendors" replace />} />
            <Route path="suppliers/old" element={<Suppliers />} />
            <Route path="*" element={<NotBuilt />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
