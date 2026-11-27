// Demo customers for a developer's computer: a few hospitals, doctors and patients, added the
// way people would add them. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { CustomerInput, Me } from "../types";
import { addCustomer } from "./service";

export async function seedDemoCustomers(db: Database): Promise<boolean> {
  const [counted] = await rows<{ count: number }>(
    db,
    sql`select count(*)::int as count from customer`,
  );
  if ((counted?.count ?? 0) > 0) return false;
  const people = await rows<{
    id: number;
    role: string;
    areaId: number | null;
    areaName: string | null;
    cities: string[] | null;
  }>(
    db,
    sql`select p.id::int as id, p.role, p.area_id::int as "areaId", a.name as "areaName", a.cities
        from person p left join area a on a.id = p.area_id where p.role in ('management', 'medrep', 'online')`,
  );
  const as = (role: string): Me | null => {
    const person = people.find((row) => row.role === role);
    if (!person) return null;
    return {
      id: person.id,
      role,
      area: person.areaId
        ? { id: person.areaId, name: person.areaName ?? "", cities: person.cities ?? [] }
        : null,
    } as Me;
  };
  const sarla = as("management");
  const ryan = as("medrep");
  const jane = as("online");
  if (!sarla || !ryan || !jane) return false;

  const credit = { paymentTerms: "days", paymentDays: 30, creditLimit: 1_000_000_00 } as const;
  const hospitals: CustomerInput[] = [
    {
      kind: "hospital",
      name: "San Juan de Dios Hospital",
      city: "Pasay",
      address: "2772 Roxas Blvd, Pasay",
      phone: "(02) 8831 9731",
      licenceNo: "LTO-H-0031",
      licenceExpires: "2027-08-31",
      ...credit,
    },
    {
      kind: "hospital",
      name: "Olivarez General Hospital",
      city: "Parañaque",
      address: "Dr. A. Santos Ave, Parañaque",
      phone: "(02) 8826 7966",
      licenceNo: "LTO-H-0118",
      licenceExpires: "2027-01-15",
      ...credit,
    },
    {
      kind: "hospital",
      name: "Las Piñas Doctors Hospital",
      city: "Las Piñas",
      address: "Aguilar Ave, Las Piñas",
      phone: "(02) 8825 5236",
      ...credit,
    },
    {
      kind: "hospital",
      name: "Davao Doctors Hospital",
      city: "Davao City",
      address: "E. Quirino Ave, Davao City",
      phone: "(082) 222 8000",
      ...credit,
    },
    {
      kind: "hospital",
      name: "Chong Hua Hospital",
      city: "Cebu City",
      address: "Don Mariano Cui St, Cebu City",
      phone: "(032) 255 8000",
      ...credit,
    },
  ];
  const ids: number[] = [];
  for (const hospital of hospitals) ids.push(await addCustomer(db, sarla, hospital));

  await addCustomer(db, sarla, {
    kind: "doctor",
    name: "Dr. Elena Cruz",
    city: "Quezon City",
    specialty: "Medical oncology",
    phone: "0917 555 0199",
    licenceNo: "PRC-0098123",
  });
  await addCustomer(db, ryan, {
    kind: "doctor",
    name: "Dr. Marco Reyes",
    city: "Pasay",
    specialty: "Hematology",
    worksAt: ids[0],
    phone: "0918 222 3344",
    licenceNo: "PRC-0112233",
  });
  await addCustomer(db, jane, {
    kind: "patient",
    name: "Rosario Santos",
    city: "Las Piñas",
    address: "BF Resort Village, Las Piñas",
    phone: "0917 555 0142",
  });
  await addCustomer(db, jane, {
    kind: "patient",
    name: "Benjamin Cruz",
    city: "Pasay",
    phone: "0998 765 4321",
  });
  await addCustomer(db, ryan, {
    kind: "drugstore",
    name: "MedExpress Drug",
    city: "Parañaque",
    phone: "(02) 8800 1234",
  });
  return true;
}
