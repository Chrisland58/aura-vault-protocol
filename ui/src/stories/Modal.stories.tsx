import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";

/**
 * `Modal` is a dialog overlay for focused tasks.
 *
 * ## Accessibility
 * - Uses `role="dialog"` and `aria-modal="true"`
 * - `aria-labelledby` links to the modal title
 * - Escape key closes the modal
 * - Initial focus set on the dialog container
 * - Backdrop click closes the modal
 */
const meta = {
  title: "Composites/Modal",
  component: Modal,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof Modal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Modal</Button>
        <Modal isOpen={open} title="Confirm deposit" onClose={() => setOpen(false)}>
          <p style={{ color: "var(--color-text-muted)", marginBottom: "1rem" }}>
            You are about to deposit 100 USDC into the Aura Vault.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => setOpen(false)}>Confirm</Button>
          </div>
        </Modal>
      </>
    );
  },
};
