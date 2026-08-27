import { PageHeader } from "@/components/shared/page-header";

/**
 * A route's page surface.
 *
 * A route is a page, not a window. This renders in the shell's normal document
 * flow and uses whatever width the shell gives it — no backdrop, no title bar,
 * no close control, nothing floating. Those belong to `WindowDialogContent`,
 * which exists for overlays a person deliberately opens on top of a page.
 *
 * Keeping the two apart is the whole point: a waiter opening Orders has
 * navigated somewhere, and the back button is what closes it. A confirmation
 * dialog is the opposite — it interrupts, and it needs a way out that is not
 * navigation.
 */
export function ModulePage({
  title,
  description,
  action,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} action={action} />
      {children}
    </div>
  );
}
