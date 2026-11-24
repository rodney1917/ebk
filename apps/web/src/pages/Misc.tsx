import { ButtonLink, Card, EmptyState, IconHelp, IconPhone, PageHeader } from '../design-system';

/** Airtime & data: UI placeholder. Fulfilment requires an approved commercial airtime API (see PROJECT_STATUS.md). */
export function AirtimePage() {
  return (
    <>
      <PageHeader title="Airtime & data" subtitle="Top up MTN and Airtel phones in Zambia" />
      <Card>
        <EmptyState
          icon={<IconPhone />}
          title="Coming soon"
          body="Airtime and data bundles for MTN Zambia and Airtel Zambia will be available once our airtime partner integration is approved."
          action={<ButtonLink to="/send" variant="secondary">Send money instead</ButtonLink>}
        />
      </Card>
    </>
  );
}

export function HelpPage() {
  const faqs = [
    ['How long does a transfer take?', 'Most mobile money transfers arrive within minutes of your payment being confirmed. Some transfers need extra checks, which can take longer.'],
    ['What does it cost?', 'You see the exact fee and exchange rate before you pay. The rate is locked for 10 minutes on the review screen.'],
    ['Is EBK a bank?', 'No. EBK is a money transfer service. Your payment is collected and paid out by authorised financial partners.'],
    ['Why do I need to verify my identity?', 'Money transfer providers are required by law to verify customers to prevent fraud and financial crime.'],
  ];
  return (
    <>
      <PageHeader title="Help & support" subtitle="Answers to common questions" />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <div className="divide-y divide-line">
            {faqs.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="cursor-pointer list-none font-semibold text-ink flex justify-between items-center">{q}<span className="text-emerald-700 group-open:rotate-45 transition-transform text-xl">+</span></summary>
                <p className="mt-2 text-sm text-muted-strong">{a}</p>
              </details>
            ))}
          </div>
        </Card>
        <Card>
          <EmptyState icon={<IconHelp />} title="Need to talk to us?" body="Support contact channels will be published before launch. Quote your transfer reference (EBK-…) so we can help quickly." />
        </Card>
      </div>
    </>
  );
}

export function NotFoundPage() {
  return <EmptyState title="Page not found" body="The page you’re looking for doesn’t exist." action={<ButtonLink to="/">Go home</ButtonLink>} />;
}
