# Zoho Books into crmnew: what Zoho does, what is here, what to build (18 Nov 2026)

Aryan (18 Nov): explore every part of Zoho Books, understand the logic behind each feature and where its
data comes from, and rebuild it in crmnew so Zoho Books is no longer needed; tie it to the CRM, Inventory,
Sales, Purchases and Finance; every transaction posts itself to the right accounts; keep history exact;
no duplicate records or entries. Zoho is read only (nothing changed there).

## 1. What Zoho Books holds and how it is used (read from the live org 714292728, 18 Nov)

Organisation: Getmeds Philippines Inc. (both companies, 2MG and Getmeds, in one set of books, told apart
by a "Company" field), PHP, fiscal year from January, **accrual** basis, opening balances on 2 May 2020.

| Module | Count | Used how | Notes |
|---|---|---|---|
| Invoices | 69,269 | From sales orders (Inventory) | Fields: Doctor Name (req), Payment Mode, Invoicing From (2MG / Getmeds), Source, Less Withholding Tax, TIN |
| Payments received | 63,283 | Bank Transfer, GCash, Bank Remittance, Cash | Withheld tax (2307) on Advance Tax, bank charges, **unused amount** (customer advance) on Unearned Revenue: 29 of the last 200 |
| Credit notes | 873 | Returns and price corrections; 105 open (credit not yet used) | Apply to invoices, refund out of a bank (54 refunds) |
| Bills | 8,879 | Mostly **account lines** (utilities, rent, services), not items | Fields: Company (req), Department, Voucher, PIC, Sales Person, Bill Number |
| Payments made | 7,420 | Paid Through a bank; excess = vendor advance | |
| Vendor credits | 46 | Applied to bills | |
| Expenses | 8,717 | **7,476 out of Petty Cash**; the rest banks / GCash | Fields: Cost Centre (GetMEDS0001 / 2MG0001 / Cenevo0001), Type (Goods / Services / Rental / Others), PIC, Department, Voucher, OR Number; tax inclusive/exclusive; itemized; vendor; customer; receipt |
| Recurring expenses | 6 | Rent (UNIT 311, …), monthly | Make the expense on the day |
| Recurring bills | 7 | Monthly bills | |
| Manual journals | 2,493 | Cash advances, reimbursements, payroll (MA), accruals, next year's rent | Fields: Department (req), Company (req), Entry Number, PIC; draft / published; reverse-journal date; per-line contact and tax |
| Transfers | 106 | Between banks, petty cash, GCash | |
| Deposits | 22 | Other income into a bank | |
| Banking | 44 accounts (33 bank, 6 cash, 5 card, payment clearing) | Everything is **manually added**; bank statements imported but **193 lines never categorized**; only 36 ever matched; **no reconciliation ever done**; no bank feeds, no bank rules | |
| Chart of accounts | 196 (+ system) | 94 expense, 33 bank, 22 fixed asset, 9 current liability… | |
| Taxes | VAT 12%, EWT 1%, Withholding 2%, Rent 5%, VAT-EWT 11%, SC/PWD 20%, No Tax | | |
| Transaction locking | Per module (Sales, Purchases, Banking, Accountant) or all | Used now and then ("PAYMENT POSTING") | |
| Reports | 97 | Used: P&L, Balance Sheet, Cash Flow, AR Aging (summary, details), AP Aging, Invoice / Bill / Credit Note / PO / SO details, Sales by Customer / Item / Salesperson, Profit by Item, Purchases by Item, Expense Details, Expenses by Employee, Tax Summary, Account Transactions, General Ledger | |
| Not used | | Estimates 0, recurring invoices 0, projects/timesheets 0, budgets 0, fixed assets 2 (test, ₱100), currency adjustments none, reporting tags none, bank rules none, bank feeds none | Not built until needed |
| Workflows | 10 | All push stock to the website (item, SO, PO, bill, adjustment) | crmnew moves stock itself |

## 2. What crmnew already has

- **Zoho's whole history** (local; not on live yet): every invoice, payment, credit note, refund, bill,
  vendor payment, vendor credit, expense, journal, transfer, deposit, recurring, fixed asset, the chart and
  the opening balances, with Zoho's ids (unique, so a re-import adds only what is missing).
- **The ledger** (`book_entry` = Zoho's documents written once in `book_ledger` + crmnew's own worked out
  as read + the CRM's own invoices, payments, refunds, returns, stock and samples in `crm_entry`). Balances
  to 3 centavos of ₱3.85B.
- **Read screens**: Banking overview and each account's transactions, Chart of Accounts with balances,
  every document with its journal, Expenses, Journals, Transfers, Deposits, Refunds, Recurring.
- **Making**: purchase orders → receives → bills → payments made, vendor credits (apply), payments
  received on Zoho's invoices, void. The CRM's order line makes invoices, payments, refunds and returns.
- **Reports**: Trial Balance, P&L, Balance Sheet, Cash Flow, VAT, Payables Aging, Gross Profit, money
  summary, sales/stock insights.

## 3. What is missing (to build, in this order)

**A. Write the books, not only read them** (Finance; CEO and Admin too)
1. Record an **expense** (Zoho's form, with its custom fields, tax inclusive/exclusive, itemized lines,
   vendor, customer, receipt); void.
2. A **manual journal** (debits = credits, per-line contact, Department / Company / PIC, draft or publish,
   reverse on a date).
3. **Transfer** between accounts; **deposit** (other income, owner's contribution) into a bank.
4. **Credit notes** made here (a price correction, goods back not through the order line): lines on
   accounts; **apply** to invoices (Zoho's and the CRM's); **refund** out of a bank. Zoho's 105 open credit
   notes can be applied or refunded here too.
5. **Customer advances**: a payment's unused amount applied to an invoice later.

**B. Control**
6. **Chart of accounts**: add an account (type, code, parent), rename, make inactive (never delete one
   with history).
7. **Transaction locking**: lock Sales / Purchases / Banking / Accountant (or all) up to a date; every
   write dated on or before is refused by the API.
8. **Recurring** expenses, bills and journals: made by themselves on their day (Zoho's 6 + 7 carry over).

**C. Banking**
9. **Import a bank statement** (CSV): lines kept per account; each line **matched** to the payment,
   expense, transfer or journal already in the books (amount and date), or **categorized** into a new
   expense / deposit / transfer / journal. Zoho's 193 uncategorized lines come over.
10. **Reconcile**: pick the statement's end date and closing balance; tick what cleared; the difference
    must be 0 to finish; reconciled entries are locked.

**D. Reports still missing**
11. General Ledger, Journal Report, Account Transactions (all accounts), AR Aging Summary and Details,
    Customer Balance Summary, Vendor Balance Summary, Expense Details / by Category / by Department / by PIC,
    Payments Received, Payments Made, Credit Note Details, Tax Summary with withholding.

**E. History exactness**
12. Read Zoho's General Ledger (Account Transactions) once, read only, so Accounts Receivable, Unearned
    Revenue, Accounts Payable, Tax Payable and the stock accounts tie to Zoho to the centavo; then the
    switch day: Zoho's documents stop, crmnew's continue.

## 4. Rules that keep it right

- One posting per document: a crmnew document is worked out from itself as read (`book_entry_calc` /
  `crm_entry`), Zoho's are written once with their Zoho id; nothing is entered twice. A document made
  here never has a Zoho id; a Zoho document is never re-made here.
- Money in whole centavos. Nothing with history is deleted: void with a reason (the void takes it off
  the ledger), edit only while not locked and not reconciled.
- Every write checks the role on the API (Finance, CEO, Admin write; others read what their desk needs).
- Every write checks the lock date of its module and refuses a closed period.
- Sales invoices still come only from the order line; purchases and bills from the Books screens.

## 5. Decisions (Aryan delegated ERP choices on 18 Nov; each can change in a line)

- Who writes the books: Finance, the CEO and the Admin (as Zoho's admins and accountants did).
- Not built until used: estimates, recurring invoices, projects, timesheets, budgets, fixed-asset
  depreciation, base-currency adjustments, reporting tags, bank feeds, bank rules.
