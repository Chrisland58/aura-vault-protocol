import type { Meta, StoryObj } from '@storybook/react';
import { Card, Stat, Button } from '../components/ds';

// ── Card ──────────────────────────────────────────────────────────────────
const cardMeta: Meta<typeof Card> = {
  title: 'Layout/Card',
  component: Card,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'raised', 'bordered'] },
    padding: { control: 'select', options: ['none', 'sm', 'md', 'lg'] },
  },
  args: { children: 'Card content goes here' },
};
export default cardMeta;
type CardStory = StoryObj<typeof Card>;

export const Default:  CardStory = { args: { variant: 'default' } };
export const Raised:   CardStory = { args: { variant: 'raised' } };
export const Bordered: CardStory = { args: { variant: 'bordered' } };
export const WithHeader: CardStory = {
  args: {
    header: <div style={{ fontWeight: 600 }}>Vault Overview</div>,
    children: <Stat label="Total Value Locked" value="$2,413,887" delta={4.2} deltaLabel="24h" />,
  },
};
export const WithHeaderFooter: CardStory = {
  args: {
    variant: 'bordered',
    header: <div style={{ fontWeight: 600 }}>Pending Harvest</div>,
    children: <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>47.3 USDC available to harvest from the yield pool.</p>,
    footer: <Button size="sm" variant="primary">Harvest Now</Button>,
  },
};
