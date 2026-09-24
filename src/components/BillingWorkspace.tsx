"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatIDR } from "@/lib/format";
import { executeOperatingAction, getPayRunDetail, listOperatingResource } from "@/lib/operating-model-api";
import { arControlSummary, billingDateLabel, billingModalTitle, billingPermission, type ArRecord, type BillablePayment, type BillingActor, type BillingClient, type BillingData, type BillingModalState, type BillingSection, type BillingSubmission, type InvoiceRecord } from "@/lib/billing-ui";


const sections: Record<BillingSection, string> = {
  invoice: "Invoice",
  tax: "Faktur Pajak",
  ar: "AR Monitoring",
  close: "Cycle Close",
  setup: "Billing Setup",
};

const initialData: BillingData = {
  clients: [],
  billablePayments: [],
  invoices: [],
  arItems: [],
  submissions: [],
};

async function loadAllBillingPages(focusSubmissionId = ""): Promise<Omit<BillingData, "submissions">> {
  const clients = new Map<string, any>();
  const billablePayments = new Map<string, any>();
  const invoices = new Map<string, any>();
  const arItems = new Map<string, any>();
  let billableOffset = 0;
  let invoiceOffset = 0;
  let arOffset = 0;
  let billableDone = false;
  let invoiceDone = false;
  let arDone = false;

  for (let page = 0; page < 100 && !(billableDone && invoiceDone && arDone); page += 1) {
    const params = new URLSearchParams({
      limit: "200",
      billableOffset: String(billableOffset),
      invoiceOffset: String(invoiceOffset),
      arOffset: String(arOffset),
    });
    if (focusSubmissionId) params.set("submissionId", focusSubmissionId);
    const response = await fetch(`/api/billing?${params.toString()}`, { credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);

    for (const row of body.clients || []) clients.set(String(row.id), row);
    for (const row of body.billablePayments || []) billablePayments.set(String(row.id), row);
    for (const row of body.invoices || []) invoices.set(String(row.id), row);
    for (const row of body.arItems || []) arItems.set(String(row.id), row);

    const meta = body.meta || {};
    billableDone = meta.billable?.nextOffset == null;
    invoiceDone = meta.invoices?.nextOffset == null;
    arDone = meta.ar?.nextOffset == null;
    if (!billableDone) billableOffset = Number(meta.billable.nextOffset);
    if (!invoiceDone) invoiceOffset = Number(meta.invoices.nextOffset);
    if (!arDone) arOffset = Number(meta.ar.nextOffset);
  }

  return {
    clients: [...clients.values()],
    billablePayments: [...billablePayments.values()],
    invoices: [...invoices.values()],
    arItems: [...arItems.values()],
  };
}

type BillingWorkspaceProps = {
  actor: BillingActor | null;
  focusSubmissionId?: string;
  focusSection?: BillingSection;
  onClearFocus?: () => void;
};

export default function BillingWorkspace({
  actor,
  focusSubmissionId = "",
  focusSection,
  onClearFocus,
}: BillingWorkspaceProps) {
  const [section, setSection] = useState<BillingSection>(focusSection || "invoice");
  const [data, setData] = useState<BillingData>(initialData);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<BillingModalState | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const role = actor?.role || "";
  const canPrepare = billingPermission(actor, "billing:prepare", ["SUPER_ADMIN", "PAYROLL_PROCESSOR"]);
  const canControl = billingPermission(actor, "billing:approve", ["SUPER_ADMIN", "PAYROLL_CONTROLLER"]);
  const canWriteAr = billingPermission(actor, "ar:write", ["SUPER_ADMIN", "PAYROLL_CONTROLLER"]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [body, operating, focused] = await Promise.all([
        loadAllBillingPages(focusSubmissionId),
        listOperatingResource("submissions"),
        focusSubmissionId
          ? getPayRunDetail(focusSubmissionId).catch(() => null)
          : Promise.resolve(null),
      ]);
      const submissions = [...(operating.submissions || [])];
      if (
        focused?.submission &&
        !submissions.some((row: BillingSubmission) => String(row.id) === String(focused.submission.id))
      ) {
        submissions.unshift(focused.submission);
      }
      setData({ ...initialData, ...body, submissions });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Gagal memuat Billing & AR",
      );
    } finally {
      setLoading(false);
    }
  }, [focusSubmissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (focusSection) {
      setSection(focusSection);
      return;
    }
    if (!focusSubmissionId) return;
    const submission = data.submissions.find((row) => String(row.id) === focusSubmissionId);
    if (!submission) return;
    const closingInvoice = ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(
      String(submission.invoice_status || ""),
    );
    setSection(
      submission.period_status === "CLOSED" || closingInvoice ? "close" : "invoice",
    );
  }, [data.submissions, focusSection, focusSubmissionId]);

  const focusedData = useMemo(() => {
    if (!focusSubmissionId) return data;
    const submissions = data.submissions.filter(
      (row) => String(row.id) === focusSubmissionId,
    );
    const billablePayments = data.billablePayments.filter(
      (row) => String(row.submission_id || "") === focusSubmissionId,
    );
    const invoices = data.invoices.filter(
      (row) => String(row.submission_id || "") === focusSubmissionId,
    );
    const invoiceIds = new Set(invoices.map((row) => String(row.id)));
    const arItems = data.arItems.filter((row) =>
      invoiceIds.has(String(row.invoice_id || "")),
    );
    const clientIds = new Set(submissions.map((row) => String(row.client_id || "")));
    const clients = data.clients.filter((row) => clientIds.has(String(row.id)));
    return { ...data, submissions, billablePayments, invoices, arItems, clients };
  }, [data, focusSubmissionId]);

  async function act(
    action: string,
    payload: Record<string, unknown>,
    success: string,
  ) {
    setNotice("Memproses…");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || `HTTP ${response.status}`);
      setModal(null);
      setForm({});
      await load();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Aksi gagal");
    }
  }

  async function saveTaxInvoice(row: any) {
    setNotice("Memproses…");
    try {
      if (form.file) {
        const upload = new FormData();
        upload.set("invoiceId", row.id);
        upload.set("file", form.file);
        const uploadResponse = await fetch("/api/tax-invoice-file", {
          method: "POST",
          credentials: "same-origin",
          body: upload,
        });
        const uploadBody = await uploadResponse.json();
        if (!uploadResponse.ok)
          throw new Error(uploadBody.error || `HTTP ${uploadResponse.status}`);
      }
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "RECORD_TAX_INVOICE",
          invoiceId: row.id,
          taxInvoiceStatus: form.status,
          taxInvoiceNumber: form.taxInvoiceNumber,
          taxInvoiceDate: form.taxInvoiceDate,
          coretaxReference: form.coretaxReference,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || `HTTP ${response.status}`);
      setModal(null);
      setForm({});
      await load();
      setNotice(
        form.file
          ? "Faktur pajak dan file pendukung tersimpan."
          : "Status faktur pajak diperbarui.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Faktur pajak gagal disimpan",
      );
    }
  }

  const totals = useMemo(() => {
    const open = focusedData.arItems.filter((r) => Number(r.balance) > 0);
    const closeReady = focusedData.submissions.filter((r) =>
      r.period_status !== "CLOSED" &&
      r.state === "COMPLETED" &&
      r.payment_status === "COMPLETED" &&
      r.reconciliation_status === "MATCHED" &&
      ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(r.invoice_status),
    ).length;
    return {
      billable: focusedData.billablePayments.length,
      review: focusedData.invoices.filter((r) =>
        ["DRAFT", "UNDER_REVIEW"].includes(r.status),
      ).length,
      closeReady,
      outstanding: open.reduce((n, r) => n + Number(r.balance || 0), 0),
      overdue: open
        .filter((r) => Number(r.aging_days) > 0)
        .reduce((n, r) => n + Number(r.balance || 0), 0),
    };
  }, [focusedData]);

  function openGenerate(row: any) {
    setForm({ reimbursement: 0, discount: 0 });
    setModal({ kind: "generate", row });
  }
  function openTax(row: any) {
    setForm({
      status: "APPROVED",
      taxInvoiceNumber: row.tax_invoice_number || "",
      taxInvoiceDate: new Date().toISOString().slice(0, 10),
      coretaxReference: row.coretax_reference || "",
    });
    setModal({ kind: "tax", row });
  }
  function openPayment(row: any) {
    setForm({
      amount: row.balance || 0,
      paidAt: new Date().toISOString().slice(0, 10),
      reference: "",
      notes: "",
    });
    setModal({ kind: "payment", row });
  }
  function openSetup(row: any) {
    setForm({
      ...row,
      paymentTermsDays: row.payment_terms_days || 30,
      taxStatus: row.tax_status || "NON_PKP",
      billingMethod: row.billing_method || "FIXED",
      billingRate: row.billing_rate || 0,
      billingAdminFee: row.billing_admin_fee || 0,
      billingTaxRate: row.billing_tax_rate ?? 11,
    });
    setModal({ kind: "setup", row });
  }

  function openClose(row: BillingSubmission) {
    setForm({ confirmation: "TUTUP PERIODE" });
    setModal({ kind: "close", row });
  }

  function openFollowUp(row: ArRecord) {
    setForm({ notes: "", nextFollowUpAt: "", disputed: false });
    setModal({ kind: "follow-up", row });
  }

  function openRevision(row: InvoiceRecord) {
    setForm({ reviewNote: "" });
    setModal({ kind: "revise", row });
  }

  async function confirmClose(row: BillingSubmission) {
    setNotice("Memproses…");
    try {
      await executeOperatingAction({
        action: "CLOSE_PAY_RUN",
        submissionId: row.id,
        confirmation: "TUTUP PERIODE",
      });
      setModal(null);
      setForm({});
      await load();
      setNotice("Payroll period berhasil ditutup. AR tetap aktif sampai pelunasan.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Period close gagal");
    }
  }

  function exportCoretax() {
    const rows = data.invoices.filter((r) => r.tax_status === "PKP");
    const csv = [
      [
        "Nomor Invoice",
        "Klien",
        "NPWP",
        "DPP",
        "PPN",
        "Tanggal Faktur",
        "Nomor Faktur",
        "Referensi Coretax",
      ],
      ...rows.map((r) => [
        r.invoice_number,
        r.company,
        r.npwp || "",
        r.subtotal,
        r.tax_amount,
        r.tax_invoice_date || "",
        r.tax_invoice_number || "",
        r.coretax_reference || "",
      ]),
    ];
    const blob = new Blob(
      [csv.map((r) => r.map(csvCell).join(",")).join("\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "proqpay-coretax.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading)
    return (
      <Panel
        title="Memuat Billing & AR…"
        detail="Menyiapkan invoice, faktur pajak, dan posisi piutang."
      />
    );

  return (
    <div className="billing-workspace" style={{ display: "grid", gap: 16 }}>
      {(focusSubmissionId || focusSection) && (
        <div className="dashboard-focus-banner" role="status">
          <span>
            Dashboard focus · {focusSubmissionId || sections[focusSection || "close"]}
          </span>
          {onClearFocus ? (
            <button type="button" onClick={onClearFocus}>Tampilkan semua</button>
          ) : null}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
          gap: 12,
        }}
      >
        <Metric
          label="Siap ditagihkan"
          value={String(totals.billable)}
          note="Payment completed"
        />
        <Metric
          label="Draft / review"
          value={String(totals.review)}
          note="Menunggu tindakan"
        />
        <Metric
          label="Ready to close"
          value={String(totals.closeReady)}
          note="Reconcile + invoice complete"
        />
        <Metric
          label="Outstanding AR"
          value={formatIDR(totals.outstanding)}
          note="Saldo piutang"
        />
        <Metric
          label="Overdue"
          value={formatIDR(totals.overdue)}
          note="Lewat jatuh tempo"
          danger={totals.overdue > 0}
        />
      </div>

      <div className="billing-tabs" style={{ display: "flex", gap: 8, overflowX: "auto" }}>
        {(Object.keys(sections) as BillingSection[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            style={tabStyle(section === key)}
          >
            {sections[key]}
          </button>
        ))}
      </div>

      {notice && (
        <div
          className={`app-notice-bubble ${/gagal|error|tidak|wajib|belum/i.test(notice) ? "app-notice-error" : "app-notice-info"}`}
          role="status"
        >
          <strong>Billing & AR</strong>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>
            ✕
          </button>
        </div>
      )}

      {section === "invoice" && (
        <InvoiceSection
          data={focusedData}
          canPrepare={canPrepare}
          canControl={canControl}
          act={act}
          generate={openGenerate}
          revise={openRevision}
          tax={openTax}
          detail={(row: InvoiceRecord) => setModal({ kind: "detail", row })}
        />
      )}
      {section === "tax" && (
        <TaxSection
          rows={focusedData.invoices}
          canControl={canControl}
          openTax={openTax}
          exportCoretax={exportCoretax}
        />
      )}
      {section === "ar" && (
        <ARSection
          rows={focusedData.arItems}
          canControl={canWriteAr}
          canFollow={canWriteAr}
          payment={openPayment}
          follow={openFollowUp}
          history={(row: ArRecord) => setModal({ kind: "ar-history", row })}
        />
      )}
      {section === "close" && (
        <CloseSection
          rows={focusedData.submissions}
          canControl={canControl}
          close={openClose}
        />
      )}
      {section === "setup" && (
        <SetupSection
          clients={focusedData.clients}
          canEdit={canPrepare}
          open={openSetup}
        />
      )}

      {modal && (
        <Modal
          title={billingModalTitle(modal.kind)}
          close={() => {
            setModal(null);
            setForm({});
          }}
        >
          {modal.kind === "generate" && (
            <GenerateForm
              row={modal.row}
              form={form}
              setForm={setForm}
              submit={() =>
                act(
                  "GENERATE_INVOICE",
                  {
                    paymentInstructionId: modal.row.id,
                    reimbursement: Number(form.reimbursement || 0),
                    discount: Number(form.discount || 0),
                  },
                  "Draft invoice berhasil dibuat.",
                )
              }
            />
          )}
          {modal.kind === "tax" && (
            <TaxForm
              form={form}
              setForm={setForm}
              submit={() => saveTaxInvoice(modal.row)}
            />
          )}
          {modal.kind === "payment" && (
            <PaymentForm
              row={modal.row}
              form={form}
              setForm={setForm}
              submit={() =>
                act(
                  "RECORD_AR_PAYMENT",
                  {
                    arId: modal.row.id,
                    amount: Number(form.amount),
                    paidAt: form.paidAt,
                    reference: form.reference,
                    notes: form.notes,
                  },
                  "Penerimaan AR berhasil dicatat.",
                )
              }
            />
          )}
          {modal.kind === "setup" && (
            <SetupForm
              form={form}
              setForm={setForm}
              submit={() =>
                act(
                  "UPDATE_BILLING_PROFILE",
                  { clientId: modal.row.id, ...form },
                  "Billing profile klien tersimpan.",
                )
              }
            />
          )}
          {modal.kind === "detail" && <InvoiceDetail row={modal.row} />}
          {modal.kind === "ar-history" && <ARHistory row={modal.row} />}
          {modal.kind === "revise" && (
            <ActionNoteForm
              label="Alasan revisi"
              value={String(form.reviewNote || "")}
              onChange={(value) => setForm({ ...form, reviewNote: value })}
              buttonText="Kembalikan untuk revisi"
              submit={() =>
                act(
                  "REVISE_INVOICE",
                  { invoiceId: modal.row.id, reviewNote: form.reviewNote },
                  "Invoice dikembalikan untuk revisi.",
                )
              }
            />
          )}
          {modal.kind === "follow-up" && (
            <FollowUpForm
              form={form}
              setForm={setForm}
              submit={() =>
                act(
                  "FOLLOW_UP_AR",
                  {
                    arId: modal.row.id,
                    notes: form.notes,
                    nextFollowUpAt: form.nextFollowUpAt || null,
                    disputed: Boolean(form.disputed),
                  },
                  "Follow-up AR tersimpan.",
                )
              }
            />
          )}
          {modal.kind === "close" && (
            <CloseConfirmation
              row={modal.row as BillingSubmission}
              submit={() => confirmClose(modal.row as BillingSubmission)}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function CloseSection({ rows, canControl, close }: any) {
  const closeRows = rows
    .filter((r: any) => r.state === "COMPLETED" || r.period_status === "CLOSED")
    .sort((a: any, b: any) => String(b.period || "").localeCompare(String(a.period || "")));
  const readiness = (r: any) => {
    if (r.period_status === "CLOSED") return { ready: false, label: "Closed", detail: "Period sudah ditutup." };
    if (r.payment_status !== "COMPLETED") return { ready: false, label: "Payment", detail: "Payment belum completed." };
    if (r.reconciliation_status !== "MATCHED") return { ready: false, label: "Reconcile", detail: "Reconciliation belum matched." };
    if (!r.invoice_status) return { ready: false, label: "Invoice", detail: "Invoice belum dibuat." };
    if (["DRAFT","UNDER_REVIEW","APPROVED"].includes(r.invoice_status)) return { ready: false, label: "Invoice", detail: `Invoice masih ${String(r.invoice_status).replaceAll("_"," ")}.` };
    if (!["ISSUED","PARTIALLY_PAID","PAID"].includes(r.invoice_status)) return { ready: false, label: "Review", detail: "Status invoice belum memenuhi close readiness." };
    return { ready: true, label: "Ready", detail: "Payment matched dan invoice sudah diterbitkan." };
  };
  return <Panel
    title="Payroll Cycle Close"
    detail="Close dilakukan setelah payment completed, reconciliation matched, dan invoice issued. Outstanding AR tetap dipantau terpisah."
  >
    {closeRows.length ? <Table
      headers={["Klien / Project","Periode","Payment","Reconcile","Invoice","Period","Aksi"]}
      rows={closeRows.map((r:any)=>{
        const status=readiness(r);
        return [
          <div key="c"><strong>{r.client_name||r.client_id}</strong><small>{r.project_name||"-"}</small></div>,
          r.period||"-",
          <Badge key="p" text={r.payment_status||"PENDING"} />,
          <Badge key="r" text={r.reconciliation_status||"PENDING"} />,
          <Badge key="i" text={r.invoice_status||"NOT_CREATED"} />,
          <Badge key="s" text={r.period_status||"OPEN"} />,
          r.period_status==="CLOSED"
            ? <small key="a">Closed by {r.closed_by||"-"}</small>
            : status.ready && canControl
              ? <button key="a" style={button} onClick={()=>close(r)}>Close period</button>
              : <small key="a">{status.detail}</small>,
        ];
      })}
    /> : <Empty text="Belum ada payroll pada tahap close." />}
  </Panel>;
}

function InvoiceSection({
  data,
  canPrepare,
  canControl,
  act,
  generate,
  revise,
  tax,
  detail,
}: any) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel
        title="Payment siap ditagihkan"
        detail="Hanya payment berstatus COMPLETED yang dapat dibuatkan invoice."
      >
        {data.billablePayments.length ? (
          <Table
            headers={[
              "Payment",
              "Klien / Project",
              "Periode",
              "Karyawan",
              "Payroll",
              "Aksi",
            ]}
            rows={data.billablePayments.map((r: any) => [
              <code key="n">{r.instruction_number}</code>,
              <div key="c">
                <strong>{r.company}</strong>
                <small>{r.project_name || "Tanpa project"}</small>
              </div>,
              r.payroll_period || "-",
              Number(r.employee_count || 0),
              formatIDR(Number(r.payroll_total || 0)),
              canPrepare ? (
                <button key="a" style={button} onClick={() => generate(r)}>
                  Buat invoice
                </button>
              ) : (
                <small key="a">Menunggu processor</small>
              ),
            ])}
          />
        ) : (
          <Empty text="Tidak ada payment baru yang siap ditagihkan." />
        )}
      </Panel>
      <Panel
        title="Daftar invoice"
        detail="Alur maker-checker: Processor menyiapkan, Controller mereview dan menerbitkan."
      >
        {data.invoices.length ? (
          <Table
            headers={[
              "Invoice",
              "Klien",
              "Periode",
              "Nilai",
              "Faktur",
              "Status",
              "Aksi",
            ]}
            rows={data.invoices.map((r: any) => [
              <button key="n" style={linkButton} onClick={() => detail(r)}>
                {r.invoice_number || "Draft"}
              </button>,
              <div key="c">
                <strong>{r.company}</strong>
                <small>{r.project_name || "-"}</small>
              </div>,
              r.period || "-",
              formatIDR(Number(r.total_amount || 0)),
              <Badge
                key="t"
                text={
                  r.tax_status === "PKP"
                    ? r.tax_invoice_status || "PENDING"
                    : "NON_PKP"
                }
              />,
              <Badge key="s" text={r.status} />,
              <div
                key="a"
                style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
              >
                {canPrepare && r.status === "DRAFT" && (
                  <button
                    style={button}
                    onClick={() =>
                      act(
                        "SUBMIT_INVOICE",
                        { invoiceId: r.id },
                        "Invoice diajukan ke Controller.",
                      )
                    }
                  >
                    Ajukan review
                  </button>
                )}
                {canControl && r.status === "UNDER_REVIEW" && (
                  <>
                    <button
                      style={button}
                      onClick={() =>
                        act(
                          "APPROVE_INVOICE",
                          { invoiceId: r.id },
                          "Invoice disetujui.",
                        )
                      }
                    >
                      Setujui
                    </button>
                    <button style={secondary} onClick={() => revise(r)}>
                      Revisi
                    </button>
                  </>
                )}
                {canControl &&
                  r.status === "APPROVED" &&
                  r.tax_status === "PKP" &&
                  r.tax_invoice_status !== "APPROVED" && (
                    <button style={button} onClick={() => tax(r)}>
                      Faktur pajak
                    </button>
                  )}
                {canControl &&
                  r.status === "APPROVED" &&
                  (r.tax_status !== "PKP" ||
                    r.tax_invoice_status === "APPROVED") && (
                    <button
                      style={button}
                      onClick={() =>
                        act(
                          "ISSUE_INVOICE",
                          { invoiceId: r.id },
                          "Invoice diterbitkan dan AR terbentuk.",
                        )
                      }
                    >
                      Terbitkan
                    </button>
                  )}
                {!["DRAFT", "UNDER_REVIEW", "APPROVED"].includes(r.status) && (
                  <button style={secondary} onClick={() => detail(r)}>
                    Lihat
                  </button>
                )}
              </div>,
            ])}
          />
        ) : (
          <Empty text="Belum ada invoice." />
        )}
      </Panel>
    </div>
  );
}

function TaxSection({ rows, canControl, openTax, exportCoretax }: any) {
  const taxable = rows.filter((r: any) => r.tax_status === "PKP");
  return (
    <Panel
      title="Faktur Pajak"
      detail="Catat hasil Coretax setelah invoice disetujui. Nomor faktur wajib sebelum invoice PKP diterbitkan."
      action={
        <button style={secondary} onClick={exportCoretax}>
          Export data Coretax
        </button>
      }
    >
      {taxable.length ? (
        <Table
          headers={[
            "Invoice",
            "Klien",
            "DPP",
            "PPN",
            "Nomor Faktur",
            "Status",
            "Aksi",
          ]}
          rows={taxable.map((r: any) => [
            r.invoice_number,
            r.company,
            formatIDR(Number(r.subtotal || 0)),
            formatIDR(Number(r.tax_amount || 0)),
            r.tax_invoice_number || "-",
            <Badge key="s" text={r.tax_invoice_status || "PENDING"} />,
            canControl &&
            ["APPROVED", "ISSUED", "PARTIALLY_PAID", "PAID"].includes(
              r.status,
            ) ? (
              <div
                key="a"
                style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
              >
                <button style={secondary} onClick={() => openTax(r)}>
                  Update / upload
                </button>
                {r.tax_invoice_file_uploaded ? (
                  <a
                    style={{ ...secondary, textDecoration: "none" }}
                    href={`/api/tax-invoice-file?invoiceId=${encodeURIComponent(r.id)}`}
                  >
                    Unduh faktur
                  </a>
                ) : null}
              </div>
            ) : (
              <small key="a">Invoice belum disetujui</small>
            ),
          ])}
        />
      ) : (
        <Empty text="Tidak ada invoice klien PKP." />
      )}
    </Panel>
  );
}

function ARSection({ rows, canControl, canFollow, payment, follow, history }: any) {
  const buckets = ["BELUM_JATUH_TEMPO", "1-30", "31-60", "61-90", ">90"];
  const totals = Object.fromEntries(
    buckets.map((b) => [
      b,
      rows
        .filter((r: any) => r.aging_bucket === b)
        .reduce((n: number, r: any) => n + Number(r.balance || 0), 0),
    ]),
  );
  const control = arControlSummary(rows as ArRecord[]);
  const appliedVariance = control.variance;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))",
          gap: 10,
        }}
      >
        <Metric label="Invoice total" value={formatIDR(control.invoice)} note="Nilai AR terbentuk" />
        <Metric label="Applied payment" value={formatIDR(control.paid)} note="Sudah dialokasikan" />
        <Metric label="Unapplied cash" value={formatIDR(control.unapplied)} note="Kelebihan / belum dialokasikan" danger={control.unapplied > 0} />
        <Metric label="Outstanding" value={formatIDR(control.outstanding)} note="Saldo piutang" />
        <Metric label="Control variance" value={formatIDR(appliedVariance)} note="Invoice − paid − outstanding" danger={appliedVariance !== 0} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))",
          gap: 10,
        }}
      >
        {buckets.map((b) => (
          <Metric
            key={b}
            label={b.replaceAll("_", " ")}
            value={formatIDR(totals[b])}
            note="Saldo berjalan"
            danger={b !== buckets[0] && totals[b] > 0}
          />
        ))}
      </div>
      <Panel
        title="Monitoring piutang"
        detail="Pembayaran parsial otomatis mengurangi saldo. Aging dihitung dari tanggal jatuh tempo."
      >
        {rows.length ? (
          <Table
            headers={[
              "Invoice",
              "Klien",
              "Jatuh tempo",
              "Aging",
              "Nilai",
              "Terbayar",
              "Unapplied",
              "Saldo",
              "Status",
              "Aksi",
            ]}
            rows={rows.map((r: any) => [
              r.invoice_number,
              <div key="c">
                <strong>{r.company}</strong>
                <small>{r.project_name || "-"}</small>
              </div>,
              date(r.due_date),
              r.aging_days > 0 ? `${r.aging_days} hari` : "Belum jatuh tempo",
              formatIDR(Number(r.amount || 0)),
              formatIDR(Number(r.paid_amount || 0)),
              formatIDR(Number(r.control?.unapplied || 0)),
              formatIDR(Number(r.balance || 0)),
              <Badge key="s" text={r.display_status || r.status} />,
              <div
                key="a"
                style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
              >
                {canControl && Number(r.balance) > 0 && (
                  <button style={button} onClick={() => payment(r)}>
                    Catat bayar
                  </button>
                )}
                {canFollow && Number(r.balance) > 0 && (
                  <button style={secondary} onClick={() => follow(r)}>
                    Follow-up
                  </button>
                )}
                <button style={secondary} onClick={() => history(r)}>
                  Riwayat
                </button>
              </div>,
            ])}
          />
        ) : (
          <Empty text="Belum ada piutang. Terbitkan invoice untuk membentuk AR." />
        )}
      </Panel>
    </div>
  );
}

function SetupSection({ clients, canEdit, open }: any) {
  return (
    <Panel
      title="Billing profile klien"
      detail="NPWP, status pajak, TOP, alamat tagihan, dan formula fee menjadi sumber invoice otomatis."
    >
      {clients.length ? (
        <Table
          headers={[
            "Klien",
            "Email tagihan",
            "Pajak",
            "TOP",
            "Metode",
            "Rate",
            "Aksi",
          ]}
          rows={clients.map((r: any) => [
            <div key="c">
              <strong>{r.name}</strong>
              <small>{r.code}</small>
            </div>,
            r.billing_email || "-",
            <Badge key="t" text={r.tax_status || "NON_PKP"} />,
            `${r.payment_terms_days || 30} hari`,
            String(r.billing_method || "FIXED").replaceAll("_", " "),
            r.billing_method === "PERCENTAGE_OF_PAYROLL"
              ? `${Number(r.billing_rate || 0).toLocaleString("id-ID")}%`
              : formatIDR(Number(r.billing_rate || 0)),
            canEdit ? (
              <button key="a" style={secondary} onClick={() => open(r)}>
                Atur billing
              </button>
            ) : (
              <small key="a">Read only</small>
            ),
          ])}
        />
      ) : (
        <Empty text="Belum ada klien." />
      )}
    </Panel>
  );
}

function GenerateForm({ row, form, setForm, submit }: any) {
  return (
    <Form submit={submit} buttonText="Buat draft invoice">
      <Info label="Payment" value={row.instruction_number} />
      <Info label="Klien" value={row.company} />
      <Info label="Payroll" value={formatIDR(Number(row.payroll_total || 0))} />
      <Field
        label="Reimbursement / pass-through"
        type="number"
        value={form.reimbursement}
        onChange={(v: any) => setForm({ ...form, reimbursement: v })}
      />
      <Field
        label="Diskon"
        type="number"
        value={form.discount}
        onChange={(v: any) => setForm({ ...form, discount: v })}
      />
    </Form>
  );
}

function TaxForm({ form, setForm, submit }: any) {
  return (
    <Form submit={submit} buttonText="Simpan hasil Coretax">
      <Select
        label="Status Coretax"
        value={form.status}
        options={["SUBMITTED", "APPROVED", "REJECTED"]}
        onChange={(v: any) => setForm({ ...form, status: v })}
      />
      <Field
        label="Nomor faktur pajak"
        value={form.taxInvoiceNumber}
        onChange={(v: any) => setForm({ ...form, taxInvoiceNumber: v })}
      />
      <Field
        label="Tanggal faktur"
        type="date"
        value={form.taxInvoiceDate}
        onChange={(v: any) => setForm({ ...form, taxInvoiceDate: v })}
      />
      <Field
        label="Referensi Coretax"
        value={form.coretaxReference}
        onChange={(v: any) => setForm({ ...form, coretaxReference: v })}
      />
      <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
        File faktur pajak (opsional)
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(event) =>
            setForm({ ...form, file: event.target.files?.[0] || null })
          }
        />
        <small style={muted}>
          Fallback manual ketika API Coretax belum aktif. PDF/JPG/PNG, maksimal
          5 MB.
        </small>
      </label>
    </Form>
  );
}

function PaymentForm({ row, form, setForm, submit }: any) {
  return (
    <Form submit={submit} buttonText="Catat penerimaan">
      <Info label="Saldo AR" value={formatIDR(Number(row.balance || 0))} />
      <Field
        label="Jumlah diterima"
        type="number"
        value={form.amount}
        onChange={(v: any) => setForm({ ...form, amount: v })}
      />
      <Field
        label="Tanggal diterima"
        type="date"
        value={form.paidAt}
        onChange={(v: any) => setForm({ ...form, paidAt: v })}
      />
      <Field
        label="Referensi bank"
        value={form.reference}
        onChange={(v: any) => setForm({ ...form, reference: v })}
      />
      <Field
        label="Catatan"
        value={form.notes}
        onChange={(v: any) => setForm({ ...form, notes: v })}
      />
    </Form>
  );
}

function SetupForm({ form, setForm, submit }: any) {
  return (
    <Form submit={submit} buttonText="Simpan billing profile">
      <div style={grid2}>
        <Field
          label="NPWP"
          value={form.npwp || ""}
          onChange={(v: any) => setForm({ ...form, npwp: v })}
        />
        <Field
          label="NITKU"
          value={form.nitku || ""}
          onChange={(v: any) => setForm({ ...form, nitku: v })}
        />
      </div>
      <Field
        label="Alamat tagihan"
        value={form.billing_address || ""}
        onChange={(v: any) =>
          setForm({ ...form, billingAddress: v, billing_address: v })
        }
      />
      <Field
        label="Email tagihan"
        type="email"
        value={form.billing_email || ""}
        onChange={(v: any) =>
          setForm({ ...form, billingEmail: v, billing_email: v })
        }
      />
      <div style={grid2}>
        <Field
          label="TOP (hari)"
          type="number"
          value={form.paymentTermsDays}
          onChange={(v: any) => setForm({ ...form, paymentTermsDays: v })}
        />
        <Select
          label="Status pajak"
          value={form.taxStatus}
          options={["NON_PKP", "PKP"]}
          onChange={(v: any) => setForm({ ...form, taxStatus: v })}
        />
      </div>
      <Field
        label="Nomor PO / kontrak"
        value={form.purchase_order || ""}
        onChange={(v: any) =>
          setForm({ ...form, purchaseOrder: v, purchase_order: v })
        }
      />
      <Select
        label="Metode billing"
        value={form.billingMethod}
        options={["FIXED", "PER_EMPLOYEE", "PERCENTAGE_OF_PAYROLL"]}
        onChange={(v: any) => setForm({ ...form, billingMethod: v })}
      />
      <div style={grid2}>
        <Field
          label="Rate"
          type="number"
          value={form.billingRate}
          onChange={(v: any) => setForm({ ...form, billingRate: v })}
        />
        <Field
          label="Admin fee"
          type="number"
          value={form.billingAdminFee}
          onChange={(v: any) => setForm({ ...form, billingAdminFee: v })}
        />
      </div>
      <Field
        label="Tarif PPN (%)"
        type="number"
        value={form.billingTaxRate}
        onChange={(v: any) => setForm({ ...form, billingTaxRate: v })}
      />
    </Form>
  );
}

function InvoiceDetail({ row }: any) {
  return (
    <div>
      <div className="billing-print-area" style={{ padding: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 20,
            borderBottom: "2px solid var(--accent)",
            paddingBottom: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>INVOICE</h2>
            <small>ProQPay</small>
          </div>
          <div style={{ textAlign: "right" }}>
            <strong>{row.invoice_number}</strong>
            <small>Tanggal: {date(row.issued_at || row.created_at)}</small>
            <small>Jatuh tempo: {date(row.due_date)}</small>
          </div>
        </div>
        <div style={{ margin: "20px 0" }}>
          <small>Ditagihkan kepada</small>
          <strong style={{ display: "block" }}>{row.company}</strong>
          <span style={{ fontSize: 12 }}>{row.billing_address || "-"}</span>
        </div>
        <Table
          headers={["Deskripsi", "Jumlah"]}
          rows={[
            [
              `Jasa payroll periode ${row.period || "-"}`,
              formatIDR(Number(row.subtotal || 0)),
            ],
            ["PPN", formatIDR(Number(row.tax_amount || 0))],
            [
              "Total",
              <strong key="t">
                {formatIDR(Number(row.total_amount || 0))}
              </strong>,
            ],
          ]}
        />
        {row.tax_invoice_number && (
          <p style={{ fontSize: 12 }}>
            Faktur pajak: <strong>{row.tax_invoice_number}</strong>
          </p>
        )}
        {Array.isArray(row.activity) && row.activity.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <strong style={{ fontSize: 12 }}>Riwayat invoice</strong>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {row.activity.slice(0, 20).map((entry: any, index: number) => (
                <div key={index} style={{ borderBottom: "1px solid var(--border-soft)", paddingBottom: 7 }}>
                  <small><strong>{String(entry.action || entry.type || "ACTIVITY").replaceAll("_", " ")}</strong> · {date(entry.at || entry.timestamp)}</small>
                  <small>{entry.username || entry.actor || "-"}{entry.detail ? ` · ${entry.detail}` : ""}</small>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 14,
        }}
      >
        {row.billing_email && (
          <a
            style={{ ...button, textDecoration: "none" }}
            href={`mailto:${row.billing_email}?subject=Invoice%20${encodeURIComponent(row.invoice_number || "ProQPay")}`}
          >
            Email klien
          </a>
        )}
        <button style={secondary} onClick={() => window.print()}>
          Cetak / Simpan PDF
        </button>
      </div>
    </div>
  );
}

function ActionNoteForm({ label, value, onChange, buttonText, submit }: { label: string; value: string; onChange: (value: string) => void; buttonText: string; submit: () => void }) {
  return (
    <Form submit={submit} buttonText={buttonText}>
      <label style={labelStyle}>
        {label}
        <textarea
          style={{ ...input, minHeight: 110, resize: "vertical" }}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        />
      </label>
    </Form>
  );
}

function FollowUpForm({ form, setForm, submit }: any) {
  return (
    <Form submit={submit} buttonText="Simpan follow-up">
      <label style={labelStyle}>
        Catatan follow-up
        <textarea
          style={{ ...input, minHeight: 110, resize: "vertical" }}
          value={form.notes || ""}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          required
        />
      </label>
      <Field
        label="Tanggal follow-up berikutnya"
        type="date"
        value={form.nextFollowUpAt || ""}
        onChange={(value: string) => setForm({ ...form, nextFollowUpAt: value })}
        required={false}
      />
      <label style={{ ...labelStyle, display: "flex", gridTemplateColumns: undefined, alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={Boolean(form.disputed)}
          onChange={(event) => setForm({ ...form, disputed: event.target.checked })}
        />
        Tandai sebagai disputed
      </label>
    </Form>
  );
}

function CloseConfirmation({ row, submit }: { row: BillingSubmission; submit: () => void }) {
  return (
    <Form submit={submit} buttonText="Tutup periode">
      <div className="billing-confirmation-summary">
        <Info label="Klien" value={String(row.client_name || row.client_id || "-")} />
        <Info label="Project" value={String(row.project_name || "-")} />
        <Info label="Periode" value={String(row.period || "-")} />
        <Info label="Payment" value={String(row.payment_status || "-")} />
        <Info label="Reconciliation" value={String(row.reconciliation_status || "-")} />
        <Info label="Invoice" value={String(row.invoice_status || "-")} />
      </div>
      <p style={{ ...muted, margin: 0 }}>
        Setelah payroll period ditutup, snapshot payroll tetap terkunci. Outstanding AR tetap aktif sampai pelunasan.
      </p>
    </Form>
  );
}

function ARHistory({ row }: any) {
  const control = row.control || {};
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={grid2}>
        <Info label="Invoice total" value={formatIDR(Number(control.invoiceTotal ?? row.amount ?? 0))} />
        <Info label="Applied payment" value={formatIDR(Number(control.paid ?? row.paid_amount ?? 0))} />
        <Info label="Unapplied cash" value={formatIDR(Number(control.unapplied ?? 0))} />
        <Info label="Outstanding" value={formatIDR(Number(control.outstanding ?? row.balance ?? 0))} />
        <Info label="Aging" value={Number(control.agingDays ?? row.aging_days ?? 0) > 0 ? `${Number(control.agingDays ?? row.aging_days)} hari` : "Belum jatuh tempo"} />
        <Info label="Control variance" value={formatIDR(Number(control.appliedDifference ?? 0))} />
      </div>
      <div>
        <strong style={{ fontSize: 12 }}>Financial activity</strong>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {(row.activity || []).slice(0, 50).map((entry: any, index: number) => (
            <div key={index} style={{ borderBottom: "1px solid var(--border-soft)", paddingBottom: 8 }}>
              <small><strong>{String(entry.type || entry.action || "ACTIVITY").replaceAll("_", " ")}</strong> · {date(entry.at)}</small>
              <small>
                {entry.reference ? `Ref ${entry.reference}` : entry.actor || entry.username || "-"}
                {Number.isFinite(Number(entry.amount)) && entry.amount !== undefined ? ` · ${formatIDR(Number(entry.amount))}` : ""}
              </small>
              {(entry.notes || entry.detail) && <small>{entry.notes || entry.detail}</small>}
            </div>
          ))}
          {!(row.activity || []).length && <Empty text="Belum ada aktivitas finansial." />}
        </div>
      </div>
    </div>
  );
}

function Modal({ title, close, children }: any) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="billing-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(15,23,42,.55)",
        display: "grid",
        placeItems: "center",
        padding: 18,
      }}
      onMouseDown={close}
    >
      <div
        className="card billing-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: "min(680px,100%)",
          maxHeight: "88vh",
          overflow: "auto",
          padding: 22,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button style={iconButton} onClick={close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Panel({ title, detail, action, children }: any) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 14,
        }}
      >
        <div>
          <h3 style={{ fontSize: 15, margin: 0 }}>{title}</h3>
          {detail && <p style={{ ...muted, margin: "5px 0 0" }}>{detail}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
function Metric({ label, value, note, danger = false }: any) {
  return (
    <div
      className="card"
      style={{
        padding: 16,
        borderColor: danger ? "rgba(220,38,38,.28)" : undefined,
      }}
    >
      <span style={muted}>{label}</span>
      <strong
        style={{
          display: "block",
          fontSize: 20,
          margin: "6px 0",
          color: danger ? "#dc2626" : undefined,
        }}
      >
        {value}
      </strong>
      <span style={muted}>{note}</span>
    </div>
  );
}
function Table({ headers, rows }: any) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
      >
        <thead>
          <tr>
            {headers.map((h: string) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any[], i: number) => (
            <tr
              key={i}
              style={{ borderBottom: "1px solid var(--border-soft)" }}
            >
              {row.map((cell: any, j: number) => (
                <td key={j} style={td}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Empty({ text }: any) {
  return (
    <div
      style={{
        padding: "28px 12px",
        textAlign: "center",
        color: "var(--text3)",
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}
function Badge({ text }: any) {
  const good = /PAID|ISSUED|APPROVED|CURRENT|NON_PKP/.test(text);
  const bad = /REJECT|OVERDUE|DISPUT/.test(text);
  const tone = good
    ? "billing-badge-good"
    : bad
      ? "billing-badge-bad"
      : "billing-badge-neutral";
  return (
    <span className={`billing-status-badge ${tone}`}>
      {String(text || "-").replaceAll("_", " ")}
    </span>
  );
}
function Form({ submit, buttonText, children }: any) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ display: "grid", gap: 13 }}
    >
      {children}
      <button
        style={{ ...button, marginTop: 6, padding: "10px 14px" }}
        type="submit"
      >
        {buttonText}
      </button>
    </form>
  );
}
function Field({ label, value, onChange, type = "text", required }: any) {
  return (
    <label style={labelStyle}>
      {label}
      <input
        style={input}
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required={required ?? ["email", "date"].includes(type)}
      />
    </label>
  );
}
function Select({ label, value, onChange, options }: any) {
  return (
    <label style={labelStyle}>
      {label}
      <select
        style={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o: string) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
function Info({ label, value }: any) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        fontSize: 12,
        padding: "9px 0",
        borderBottom: "1px solid var(--border-soft)",
      }}
    >
      <span style={{ color: "var(--text3)" }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
const date = billingDateLabel;
const csvCell = (v: any) => `"${String(v ?? "").replaceAll('"', '""')}"`;
const muted: any = { color: "var(--text3)", fontSize: 11 };
const grid2: any = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
  gap: 12,
};
const th: any = {
  textAlign: "left",
  padding: "10px 12px",
  background: "var(--bg-subtle)",
  color: "var(--text2)",
  fontSize: 10,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
const td: any = { padding: "11px 12px", verticalAlign: "middle" };
const button: any = {
  border: 0,
  borderRadius: 8,
  background: "var(--accent)",
  color: "var(--accent-contrast)",
  padding: "7px 10px",
  fontSize: 11,
  fontWeight: 650,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const secondary: any = {
  ...button,
  background: "var(--bg-surface)",
  color: "var(--text2)",
  border: "1px solid var(--border)",
};
const linkButton: any = {
  border: 0,
  background: "transparent",
  color: "var(--accent)",
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
};
const iconButton: any = {
  border: 0,
  background: "var(--bg-subtle)",
  color: "var(--text)",
  borderRadius: 8,
  width: 32,
  height: 32,
  cursor: "pointer",
};
const input: any = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-surface)",
  color: "var(--text)",
  padding: "9px 10px",
  fontSize: 12,
};
const labelStyle: any = {
  display: "grid",
  gap: 6,
  fontSize: 11,
  fontWeight: 650,
  color: "var(--text2)",
};
const tabStyle = (active: boolean): any => ({
  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
  borderRadius: 9,
  background: active ? "var(--accent-soft)" : "var(--bg-surface)",
  color: active ? "var(--accent)" : "var(--text2)",
  padding: "9px 12px",
  fontSize: 12,
  fontWeight: 650,
  cursor: "pointer",
  whiteSpace: "nowrap",
});
