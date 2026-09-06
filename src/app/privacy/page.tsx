import Link from 'next/link';
import { AppFooter } from '@/components/AppFooter';

export const metadata = {
  title: 'Privacy Policy - Cut Planner',
  description:
    'Cut Planner privacy policy. No accounts, no server-side storage of your projects. Data is kept in your browser, plus PostHog analytics and Sentry error tracking.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main id="main-content" className="max-w-4xl mx-auto px-4 py-10 space-y-12 flex-1 w-full">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Cut Planner is a free, client-side tool. There are no accounts and your
            projects are never uploaded to a server. This page explains exactly what
            happens to your data when you use the app.
          </p>
        </div>

        <Section title="What We Store">
          <p>
            Cut Planner saves your project to your browser&apos;s <code>localStorage</code>{' '}
            so your work is still there the next time you open the app:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
            <li>
              <span className="font-medium">Your project</span>: stock sheets, panels,
              kerf setting, unit system, and the last cutting layout you generated
            </li>
            <li>
              <span className="font-medium">Theme preference</span>: light, dark, or
              system
            </li>
          </ul>
          <p>
            All of this data lives exclusively in your browser and is never sent to a
            server. You can clear it at any time by clearing your browser&apos;s
            localStorage for this site, or by starting a new project.
          </p>
        </Section>

        <Section title="What We Don't Collect">
          <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
            <li>No user accounts or registration</li>
            <li>No personal data or PII</li>
            <li>No advertising or ad networks</li>
            <li>No server-side storage of your projects</li>
          </ul>
          <p>
            All cutting layout calculations run entirely in your browser. The app does
            send anonymous product-usage analytics and crash reports, described below.
          </p>
        </Section>

        <Section title="Analytics & Error Tracking">
          <p>
            Cut Planner uses one analytics service and one error-tracking service to
            understand which features are used and to catch bugs.
          </p>
          <p>
            <a
              href="https://posthog.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              PostHog
            </a>{' '}
            records anonymous product-usage events, such as page views. Autocapture and
            session recording are turned off, so it never captures your clicks,
            keystrokes, or the contents of your project. Events are processed by
            PostHog, Inc.
          </p>
          <p>
            <a
              href="https://sentry.io/privacy/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Sentry
            </a>{' '}
            captures uncaught errors so bugs can be fixed. It may include technical
            details like the page URL and browser information at the time of the error.
            Data is processed by Functional Software, Inc. (Sentry).
          </p>
        </Section>

        <Section title="Third-Party Links">
          <p>
            The &ldquo;Buy me a coffee&rdquo; link in the footer goes to{' '}
            <a
              href="https://buymeacoffee.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              buymeacoffee.com
            </a>
            , which has its own terms and privacy policy. No data is shared with Buy Me
            a Coffee unless you choose to visit that site.
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
