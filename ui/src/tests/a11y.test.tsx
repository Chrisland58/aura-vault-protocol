import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { expect, describe, it, vi } from "vitest";
import { DepositForm } from "../components/DepositForm";
import { WithdrawForm } from "../components/WithdrawForm";
import { HarvestPanel } from "../components/HarvestPanel";
import { Toast } from "../components/Toast";
import { Modal } from "../components/Modal";
import { Skeleton } from "../components/Skeleton";
import { ErrorMessage } from "../components/ErrorMessage";
import { ErrorBoundary } from "../components/ErrorBoundary";
import App from "../App";

expect.extend(toHaveNoViolations);

const noop = vi.fn();

describe("Accessibility (axe WCAG 2.1 AA)", () => {
  it("App has no violations", async () => {
    const { container } = render(<App />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("DepositForm has no violations", async () => {
    const { container } = render(<DepositForm onToast={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("WithdrawForm has no violations", async () => {
    const { container } = render(<WithdrawForm onToast={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("HarvestPanel has no violations", async () => {
    const { container } = render(<HarvestPanel onToast={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Toast has no violations", async () => {
    const { container } = render(
      <Toast message={{ type: "success", text: "Done" }} onDismiss={noop} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Modal has no violations when open", async () => {
    render(
      <Modal isOpen={true} title="Confirm" onClose={noop}>
        <p>Modal content</p>
      </Modal>
    );
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("Skeleton has no violations", async () => {
    const { container } = render(<Skeleton rows={3} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("ErrorMessage has no violations", async () => {
    const err = { message: "Connection lost.", action: "Check your internet.", severity: "error" as const, retryable: true };
    const { container } = render(<ErrorMessage error={err} onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("ErrorBoundary fallback has no violations", async () => {
    const ThrowOnRender = () => { throw new Error("test"); };
    const { container } = render(
      <ErrorBoundary><ThrowOnRender /></ErrorBoundary>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
