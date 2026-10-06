import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';
import { FileDropzone, MediaGate, type MediaItem } from './FileDropzone.js';
import { StickyFooter } from './StickyFooter.js';

const meta = {
  title: 'Primitives/FileDropzone',
  component: FileDropzone,
  args: {
    label: 'Add evidence photos',
    hint: 'Helps TrustOps resolve this faster',
    media: [],
    requiredCount: 0,
  },
} satisfies Meta<typeof FileDropzone>;

export default meta;
type Story = StoryObj<typeof meta>;

/** C7: evidence is welcome but not required, so `requiredCount` is an explicit zero. */
export const Optional: Story = {};

/** A wrong photo has to be removable, or the only way back is abandoning the screen. */
export const Removable: Story = {
  render: function Removable(args) {
    const [media, setMedia] = useState<MediaItem[]>([
      { id: 'a', alt: 'Receipt' },
      { id: 'b', kind: 'video' },
    ]);
    return (
      <FileDropzone
        {...args}
        media={media}
        onRemove={(id) => {
          setMedia((current) => current.filter((item) => item.id !== id));
        }}
      />
    );
  },
};

/** W1: the gate. Accept stays locked until real media is attached. */
export const GateClosed: Story = {
  args: { label: 'Add proof of possession', hint: 'A photo or video of the item', requiredCount: 1 },
};

export const GateOpen: Story = {
  args: {
    label: 'Add proof of possession',
    requiredCount: 1,
    media: [{ id: 'a', kind: 'video', alt: 'MacBook Air, lid open' }],
  },
};

/** W1 end to end: attaching the proof is what unlocks Accept, and nothing else can. */
export const WithTheAcceptGate: Story = {
  render: function WithTheAcceptGate(args) {
    const [media, setMedia] = useState<MediaItem[]>([]);
    return (
      <div className="w-[308px]">
        <FileDropzone
          {...args}
          label="Add proof of possession"
          hint="A photo or video of the item in your possession"
          requiredCount={1}
          media={media}
          onAdd={(files) => {
            setMedia((current) => [...current, ...files.map((file) => ({ id: file.name, alt: file.name }))]);
          }}
        />
        <StickyFooter>
          <MediaGate media={media} requiredCount={1}>
            {(satisfied) => <Button disabled={!satisfied}>Accept trade request</Button>}
          </MediaGate>
          <Button variant="secondary">Propose changes instead</Button>
        </StickyFooter>
      </div>
    );
  },
};
