import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const employers = pgTable("employers", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
});

export const clients = pgTable("clients", {
  id: serial().primaryKey(),
  code: text().notNull().unique(),
  name: text().notNull(),
});

export const branches = pgTable("branches", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
});

export const workUnits = pgTable("work_units", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
});

export const positions = pgTable("positions", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
});

export const banks = pgTable("banks", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
});

export const workLocations = pgTable(
  "work_locations",
  {
    id: serial().primaryKey(),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id),
    name: text().notNull(),
    picName: text("pic_name").notNull(),
    hrbpName: text("hrbp_name").notNull(),
    minimumWageCity: text("minimum_wage_city").notNull(),
  },
  (table) => [
    uniqueIndex("work_locations_identity_idx").on(
      table.branchId,
      table.name,
      table.picName,
      table.hrbpName,
      table.minimumWageCity,
    ),
  ],
);

export const employees = pgTable("employees", {
  id: serial().primaryKey(),
  employeeNumber: text("employee_number").notNull().unique(),
  fullName: text("full_name").notNull(),
  identityNumber: text("identity_number").notNull().unique(),
  birthPlace: text("birth_place").notNull(),
  birthDate: date("birth_date").notNull(),
  gender: text().notNull(),
  religion: text().notNull(),
  address: text().notNull(),
  phoneNumber: text("phone_number"),
  mobileNumber: text("mobile_number"),
  email: text(),
  motherName: text("mother_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const employeeTaxProfiles = pgTable("employee_tax_profiles", {
  id: serial().primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: "cascade" }),
  taxNumber: text("tax_number").notNull().unique(),
  maritalStatus: text("marital_status").notNull(),
  recognizedPtkpStatus: text("recognized_ptkp_status").notNull(),
  currentPtkpStatus: text("current_ptkp_status").notNull(),
});

export const employmentAssignments = pgTable(
  "employment_assignments",
  {
    id: serial().primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    employerId: integer("employer_id")
      .notNull()
      .references(() => employers.id),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    locationId: integer("location_id")
      .notNull()
      .references(() => workLocations.id),
    workUnitId: integer("work_unit_id")
      .notNull()
      .references(() => workUnits.id),
    positionId: integer("position_id")
      .notNull()
      .references(() => positions.id),
    acceptedDate: date("accepted_date").notNull(),
    joinDate: date("join_date").notNull(),
    employeeStatus: text("employee_status").notNull(),
    contractType: text("contract_type").notNull(),
    contractStartDate: date("contract_start_date").notNull(),
    contractEndDate: date("contract_end_date").notNull(),
    terminationDate: date("termination_date"),
    terminationReason: text("termination_reason"),
    operationalUser: text("operational_user"),
  },
  (table) => [
    uniqueIndex("employment_assignments_employee_contract_idx").on(
      table.employeeId,
      table.contractStartDate,
    ),
    index("employment_assignments_client_idx").on(table.clientId),
    index("employment_assignments_location_idx").on(table.locationId),
  ],
);

export const salaryHistories = pgTable(
  "salary_histories",
  {
    id: serial().primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    effectiveDate: date("effective_date").notNull(),
    baseSalary: integer("base_salary").notNull(),
  },
  (table) => [
    uniqueIndex("salary_histories_employee_effective_idx").on(
      table.employeeId,
      table.effectiveDate,
    ),
  ],
);

export const employeeBankAccounts = pgTable("employee_bank_accounts", {
  id: serial().primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: "cascade" }),
  bankId: integer("bank_id")
    .notNull()
    .references(() => banks.id),
  accountNumber: text("account_number").notNull().unique(),
});

export const employeeSocialSecurity = pgTable("employee_social_security", {
  id: serial().primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: "cascade" }),
  healthInsuranceNumber: text("health_insurance_number").notNull().unique(),
  healthInsuranceEffectiveDate: date("health_insurance_effective_date").notNull(),
  employmentInsuranceNumber: text("employment_insurance_number").notNull().unique(),
});

export const employeeEducation = pgTable("employee_education", {
  id: serial().primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: "cascade" }),
  educationLevel: text("education_level").notNull(),
  schoolName: text("school_name").notNull(),
  major: text(),
  graduationYear: integer("graduation_year").notNull(),
});

export const employeeImportMetadata = pgTable("employee_import_metadata", {
  id: serial().primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: "cascade" }),
  sourceRowNumber: integer("source_row_number").notNull(),
  candidateSource: text("candidate_source").notNull(),
  fjInputDate: date("fj_input_date"),
  fjInputUser: text("fj_input_user"),
  esInputDate: date("es_input_date"),
  esInputUser: text("es_input_user"),
  inputDate: date("input_date").notNull(),
  inputUser: text("input_user").notNull(),
});
