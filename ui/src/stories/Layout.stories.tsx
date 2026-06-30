import type { Meta, StoryObj } from '@storybook/react';
import { Badge, Avatar, Divider, Stack } from '../components/ds';

// ── Badge ─────────────────────────────────────────────────────────────────
export const BadgeStories: Meta<typeof Badge> = {
  title: 'Layout/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'Active' },
};

// ── Avatar ────────────────────────────────────────────────────────────────
const avatarMeta: Meta<typeof Avatar> = {
  title: 'Layout/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  argTypes: {
    size:   { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    status: { control: 'select', options: ['online', 'offline', 'busy', undefined] },
  },
  args: { name: 'Alice Keeper' },
};
export default avatarMeta;
type AvatarStory = StoryObj<typeof Avatar>;

export const Initials:    AvatarStory = {};
export const AllSizes:    AvatarStory = {
  render: () => (
    <Stack direction="row" gap={4} align="center">
      {(['xs','sm','md','lg','xl'] as const).map(s => <Avatar key={s} name="Alice Keeper" size={s} />)}
    </Stack>
  ),
};
export const WithStatus:  AvatarStory = { args: { status: 'online' } };
export const AllVariants: AvatarStory = {
  render: () => (
    <Stack direction="row" gap={4} align="center">
      <Avatar name="Alice Keeper" status="online"  />
      <Avatar name="Bob Vault"    status="offline" />
      <Avatar name="Carol APY"    status="busy"    />
    </Stack>
  ),
};

// ── Divider ───────────────────────────────────────────────────────────────
export const DividerStory = {
  title: 'Layout/Divider',
  render: () => (
    <div style={{ width: 320 }}>
      <p style={{ color: 'var(--color-text-muted)' }}>Section A</p>
      <Divider />
      <p style={{ color: 'var(--color-text-muted)' }}>Section B</p>
      <Divider label="OR" />
      <p style={{ color: 'var(--color-text-muted)' }}>Section C</p>
    </div>
  ),
};
