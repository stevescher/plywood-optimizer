import Link from 'next/link';
import { AppFooter } from '@/components/AppFooter';

export const metadata = {
  title: 'Terms of Use - Cut Planner',
  description:
    'Cut Planner terms of use. Cutting layouts are a planning aid, not a guarantee. No warranty, no liability for wasted material or damaged tools.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main id="main-content" className="max-w-4xl mx-auto px-4 py-10 space-y-12 flex-1 w-full">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Terms of Use</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Cut Planner is a free tool that generates cutting layouts for plywood and
            sheet goods. Read this page before relying on its output for a real project.
          </p>
        </div>

        <Section title="Layouts Are a Planning Aid">
          <p>
            Every layout Cut Planner produces is a{' '}
            <span className="font-medium">starting point</span>, not a guarantee. It is
            based on the dimensions and kerf you enter, and it assumes your stock and
            saw cuts are exact. Real sheets can be undersized, warped, or out of square,
            and a saw can wander off its line.
          </p>
          <p>
            <span className="font-medium">Double-check every dimension against your
            actual stock before cutting</span>, and measure twice on the material
            itself, not just on screen.
          </p>
        </Section>

        <Section title="No Warranty">
          <p>
            Cut Planner is provided &ldquo;as is&rdquo; with no warranty of any kind,
            express or implied. That includes, but is not limited to, warranties of
            accuracy, fitness for a particular purpose, and merchantability.
          </p>
          <p>
            The layout&apos;s output may be wrong. Edge cases in the packing algorithm
            may produce a cut order or panel placement that does not match your
            intentions. You use the tool at your own risk.
          </p>
        </Section>

        <Section title="No Liability">
          <p>
            The author is not responsible for any loss or damage arising from use of
            Cut Planner&apos;s output, including:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
            <li>Wasted material or miscut panels</li>
            <li>Damage to saws, blades, or workholding</li>
            <li>Personal injury from cutting equipment</li>
            <li>Project delays or cost overruns</li>
          </ul>
          <p>
            The full risk of cutting your material is yours. By using this tool, you
            accept that the author has no liability for any loss, damage, or injury
            connected to its use.
          </p>
        </Section>

        <Section title="Operator Responsibility">
          <p>You are responsible for safe operation of your own tools. That means:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
            <li>Wearing appropriate PPE, including eye and hearing protection</li>
            <li>Secure workholding and a properly guarded saw</li>
            <li>Verifying every measurement against your physical stock before cutting</li>
            <li>Following your tool manufacturer&apos;s documentation and safety guidance</li>
          </ul>
        </Section>

        <Section title="Your Data">
          <p>
            Your projects are stored only in your browser. See the{' '}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>{' '}
            for details. The author is not responsible for lost project data due to
            cleared browser storage, browser bugs, or any other cause. Export your
            project to a file if you want a durable backup.
          </p>
        </Section>

        <div className="pt-4 border-t border-border">
          <Link href="/" className="text-sm text-primary hover:underline">
            ← Back to Cut Planner
          </Link>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2">
        {title}
      </h2>
      <div className="space-y-3 text-sm text-foreground leading-relaxed">{children}</div>
    </section>
  );
}
