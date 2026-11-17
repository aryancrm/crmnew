// The 2026 org chart (HR, 10 Oct 2026), as units and seats. Each seat points at a role in
// company-map.data.js. `who` is the person in the seat on the chart; `n` how many such seats.
window.COMPANY_UNITS = [
  { id: "company", name: "Founder / Mentor", head: "Naresh Bishnoi" },

  // ---------------------------------------------------------------- Hospital Division
  {
    id: "hospital", parent: "company", tone: "hos", name: "Hospital Division", head: "Vanessa Escalderon · Business Mentor",
    note: "Sells to hospitals, private and government, region by region. Each team: a District Sales Coach and the CHCs who each hold a territory.",
    seats: [{ role: "business-mentor", who: "Vanessa Escalderon" }],
  },
  { id: "hos-ncr1", parent: "hospital", name: "NCR 1", seats: [
    { role: "dsc", who: "Daniel Cruz" },
    { role: "hospital-chc", places: "Pasay, Manila", who: "Ryan Aninon" },
    { role: "hospital-chc", places: "Las Piñas, Taguig", who: "Luis Jasper Palingping" },
    { role: "hospital-chc", places: "Parañaque", who: "Ana Mae Otucan" },
    { role: "hospital-chc", places: "Palawan", who: "Patrick Adion" },
  ] },
  { id: "hos-ncr2", parent: "hospital", name: "NCR 2", seats: [
    { role: "dsc", who: "Jim Lord Palomares" },
    { role: "hospital-chc", places: "Quezon City", who: "Princess Cuerdo" },
    { role: "hospital-chc", places: "Camanava, Bulacan", who: "Den Jane Suarez" },
    { role: "hospital-chc", places: "Marikina, Pasig", who: "Jacob Cruz" },
    { role: "inside-coachee", title: "Customer Happiness Coachee", who: "Jomari Esguerra" },
  ] },
  { id: "hos-ncl", parent: "hospital", name: "North & Central Luzon", seats: [
    { role: "dsc", who: "Julius S. Abucay" },
    { role: "hospital-chc", places: "Tuguegarao, Isabela", who: "Nicole Anne Castillo" },
    { role: "hospital-chc", places: "Cabanatuan, Nueva Ecija, Tarlac", who: "Paolo Paradero" },
    { role: "hospital-chc", places: "Baguio, Ilocos, La Union", who: "Gabrielle Agripa" },
    { role: "hospital-chc", places: "Pampanga, Bataan, Zambales", who: "vacant" },
  ] },
  { id: "hos-sl", parent: "hospital", name: "South Luzon", seats: [
    { role: "dsc", who: "Kindred Malauan" },
    { role: "hospital-chc", places: "Bicol", who: "Lalien G. Nunez" },
    { role: "hospital-chc", places: "Laguna, Batangas", who: "Clarisse Deocareza" },
    { role: "hospital-chc", places: "Cavite, Laguna", who: "Glenn Bernabe" },
    { role: "hospital-chc", places: "Quezon Province, Mindoro", who: "John Michael Orig" },
  ] },
  { id: "hos-vis", parent: "hospital", name: "Visayas", note: "No coach drawn: the CHCs report to the Business Mentor.", seats: [
    { role: "hospital-chc", places: "Cebu South, Dumaguete", who: "Andrealyn Bermido" },
    { role: "hospital-chc", places: "Cebu North, Bohol", who: "Kristofferson Conde" },
    { role: "hospital-chc", places: "Iloilo, Bacolod, Roxas", who: "Jessa Mae Teruel" },
  ] },
  { id: "hos-min", parent: "hospital", name: "Mindanao", seats: [
    { role: "dsc", who: "Saurav Kumar" },
    { role: "hospital-chc", places: "Gen San, South Cotabato", who: "Harley Queen Orani" },
    { role: "hospital-chc", places: "Davao North", who: "Rubelyn Ramos" },
    { role: "hospital-chc", places: "Cagayan de Oro, Butuan, Iligan", who: "Melanie Diaz" },
    { role: "hospital-chc", places: "Davao South", who: "Welmar Pancho" },
    { role: "hospital-chc", places: "Zamboanga, Pagadian, Dipolog", who: "Maycarl Degamo" },
  ] },
  { id: "hos-gov", parent: "hospital", name: "Government Account", seats: [
    { role: "gov-account", who: "Reynan Cuenca" },
  ] },
  { id: "hos-mdts", parent: "hospital", name: "MD Telesales Anesthesia", note: "Sells anesthesia products to doctors and hospitals by phone and chat.", seats: [
    { role: "md-telesales", n: 5, who: "Micah Jimena, Aila Zaragoza, Sheena Correa, Paula Pentallana, Mary Rose Goron" },
  ] },
  { id: "hos-pap", parent: "hospital", name: "Patient Assistance Program", seats: [
    { role: "pap-officer", who: "Fhaye Norella" },
  ] },

  // ---------------------------------------------------------------- Prescription Business
  {
    id: "rx", parent: "company", tone: "rx", name: "Prescription Business", head: "Javed Shaikh · PH Country Mentor",
    note: "Works with doctors (oncology, hematology, urology) whose patients buy from us. Uro & Onco Care and Blood & Bone Care work the same way: one team for the system.",
    seats: [{ role: "country-mentor", who: "Javed Shaikh" }, { role: "sales-admin", title: "Sales Admin", who: "Kate Cagoyong" }],
  },
  { id: "rx-onco", parent: "rx", name: "Onco-Hema Division", tag: "Uro & Onco Care · Blood & Bone Care", seats: [
    { role: "rx-chc", places: "NCR 1", who: "Angelica Mae Saludes" },
    { role: "rx-chc", places: "NCR 2", n: 2, who: "Eloisa Villanda, Noel Valencia" },
    { role: "rx-chc", places: "North & Central Luzon (Onco)", who: "Gienel Carlos" },
    { role: "rx-chc", places: "South Luzon (Onco, Uro)", n: 2, who: "Kevin Sean Apid, Allysa Mae Madera" },
    { role: "rx-chc", places: "Cebu (Onco, Uro)", n: 2, who: "Antonette Lawas, Jice Joyce Fajardo" },
    { role: "rx-chc", places: "Davao (Onco)", who: "Meryanie Arcangel" },
    { role: "rx-chc", places: "Blood & Bone Care", n: 2, who: "Merry Joyce Sebastian, Marwin Dy" },
  ] },
  // Inside the Onco-Hema Division, beside Uro & Onco Care and Blood & Bone Care (HR's chart, 10 Oct 2026).
  { id: "rx-mdts", parent: "rx-onco", name: "MD Telesales Oncology", seats: [
    { role: "telesales-coach", who: "Honey Cordero" },
    { role: "sales-admin", title: "Sales Admin", who: "Sheila Mae Bazar" },
    { role: "md-telesales", n: 4, who: "Mitzi Francisco, Emmanuel Greg Escalona, Ailyn Mancilla, Khalygen Boayes" },
  ] },
  { id: "rx-b2c", parent: "rx-mdts", name: "B2C Sales Coaching", note: "Patients buying online and by phone.", seats: [
    { role: "b2c-chc", n: 2, who: "Mary Jane Viñas, Rachelle Upao" },
  ] },

  // ---------------------------------------------------------------- Sales and Marketing
  {
    id: "sm", parent: "company", tone: "sm", name: "Sales and Marketing", head: "Subir Dey · Sales and Marketing Mentor",
    note: "Drugstores, distributors, clinics and government buyers.",
    seats: [{ role: "sm-mentor", who: "Subir Dey" }],
  },
  { id: "sm-clidp", parent: "sm", name: "CLIDP", seats: [
    { role: "clidp-coach", n: 2, who: "Ma. Anicia D. Maglatang, Nicka Angelene Masusi" },
  ] },
  { id: "sm-bid", parent: "sm", name: "Government Bidding", seats: [
    { role: "bidding-admin", who: "Jimmy Boy Saturinas" },
    { role: "bidding-coachee", n: 2, who: "Angelica Gollena, Hazel Marie Balano" },
    { role: "inside-coachee", title: "Customer Happiness Coachee", who: "Arron Tongcua" },
    { role: "sales-admin", title: "Sales Admin", who: "Aljean Carno" },
  ] },
  { id: "sm-b2b", parent: "sm", name: "B2B Telesales", seats: [
    { role: "b2b-coach", who: "Jessa Domino" },
    { role: "b2b-coach", title: "B2B District Sales Coach", places: "Mindanao", who: "Claire Gallana" },
  ] },
  { id: "sm-crr", parent: "sm-b2b", name: "Client Retention & Reorder (CRR)", note: "Keeps onboarded accounts buying every month.", seats: [
    { role: "crr", who: "Fritzie Mier" },
  ] },
  { id: "sm-nbd", parent: "sm-b2b", name: "New Business Development (NBD)", note: "Finds and onboards new accounts.", seats: [
    { role: "nbd", n: 4, who: "Floremel Medina, Lonie Ann Neri, Winbelle Faith Gomez, Benjie Dan Lacebal" },
  ] },

  // ---------------------------------------------------------------- Modern Trade
  { id: "mt", parent: "company", tone: "mt", name: "Modern Trade", head: "Malou Jagonoy · Chief Operating Officer", note: "Pharmacy chains. Nobody drawn under it yet.", seats: [
    { role: "coo", who: "Malou Jagonoy" },
  ] },

  // ---------------------------------------------------------------- Support
  { id: "exec", parent: "company", tone: "top", name: "Executive and Admin", seats: [
    { role: "exec-admin", title: "Executive and Admin Coach", who: "Mira Verango" },
    { role: "exec-admin", title: "Executive and Admin Coachee", who: "Jasmine Guatchin" },
  ] },
  { id: "dm", parent: "company", tone: "mk", name: "Digital Marketing", seats: [
    { role: "digital-marketing", title: "Digital Marketing Coach", who: "Kriscel Calbayar" },
    { role: "digital-marketing", title: "Multimedia Artist", who: "Arnel Catome" },
  ] },
  { id: "it", parent: "company", tone: "it", name: "IT Division", seats: [
    { role: "it", title: "Employee Happiness Coachee", n: 5, who: "Jade Atyla Madigal, Linus Aurin, Cendric Angelo Gencianos, Aaron Manila, Zildian Bermas" },
  ] },
  { id: "reg", parent: "company", tone: "reg", name: "In-Licensing & Regulatory", seats: [] },
  { id: "reg-inl", parent: "reg", name: "In-Licensing", seats: [
    { role: "in-licensing", title: "In-Licensing Mentor", who: "Esther Roselle Chiong" },
    { role: "in-licensing", title: "In-Licensing Coach", who: "Sandeep Garg" },
    { role: "in-licensing", title: "In-Licensing Executive", n: 2, who: "Dhebbie Valerie Rillera, Maria Cassandra Evangelista" },
  ] },
  { id: "reg-ra", parent: "reg", name: "Regulatory Affairs", seats: [
    { role: "regulatory", title: "Regulatory Affairs Mentor", who: "Ivy Marcel Varias" },
    { role: "regulatory", title: "Regulatory Affairs Coach", who: "Charish Mae Pasenio" },
    { role: "regulatory", title: "Regulatory Affairs Pharmacist", n: 3, who: "Alikka Mable Cangco, Romevic Cabardo, Fritz Cayunda" },
    { role: "regulatory", title: "Regulatory Affairs Coachee", n: 3, who: "Abegail Aspa, Mary Jane Padojinog, Amisha Koul (India)" },
  ] },
  { id: "hr", parent: "company", tone: "hr", name: "HR · Talent Development & Growth", seats: [
    { role: "hr", title: "Talent Development & Growth Mentor", who: "Mike Angelo Hizon" },
    { role: "hr", title: "Talent Development & Growth Coach", who: "Gilbert Ca…" },
    { role: "hr", title: "Talent Development & Growth Coachee", n: 2, who: "Shekaina Lapitan, Sherwin Villarosa" },
    { role: "hr", title: "Employee Happiness Coachee", who: "Daryl Oberos" },
    { role: "training-coach", title: "Training Coach (new seat)", who: "to hire" },
  ] },
  { id: "ops", parent: "company", tone: "ops", name: "Supply Chain, Operations & Finance", head: "Malou Jagonoy · Finance Mentor; Sarla Devi · Finance Coach", seats: [
    { role: "finance-mentor", who: "Malou Jagonoy" },
    { role: "finance-coach", who: "Sarla Devi" },
  ] },
  { id: "ops-sc", parent: "ops", name: "Supply Chain", seats: [
    { role: "supply-chain", title: "Export Coordinator", who: "Yash Parmar" },
  ] },
  { id: "ops-pharm", parent: "ops", name: "Pharmacy Operations", note: "The warehouses: main (Getmeds Philippines Inc.), Cebu, Davao.", seats: [
    { role: "pharmacy-coach", title: "Pharmacy Happiness Coach", who: "Tiara Evangelista" },
    { role: "pharmacist", title: "Company Pharmacist", places: "Main", who: "Glyssa Delfino" },
    { role: "pharmacist", title: "Company Pharmacist", places: "Cebu", who: "Paula Anne Rivilla" },
    { role: "pharmacist", title: "Company Pharmacist", places: "Davao", who: "Emie Bacoron" },
    { role: "pharmacy-coachee", title: "Pharmacy Happiness Coachee", n: 5, who: "Michael R. Uy, Jefferson Basaysay, Ralph Renzo Belo, Rey Francis Dazo, Porvenir Jabonillo" },
  ] },
  { id: "ops-fin", parent: "ops", name: "Finance Department", seats: [
    { role: "accounting", title: "Accounting Coach", who: "Rommel Arcanghel" },
    { role: "finance-coach", title: "Finance Coach", who: "Cristal Mae Corros" },
    { role: "finance-coachee", title: "Finance Coachee", n: 4, who: "Aubrey Laurista, Maria Veronica Fijo, Saroj Kumar, Erica Mari Lopez" },
  ] },
];
