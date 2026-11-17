'use client';

import {
  NoteBanner,
  OptionCard,
  ScreenColumn,
  ScreenHeader,
  SettingsGroup,
  SettingsRow,
  Toggle,
} from '@komtru/ui-kit';
import { TEXT_SIZES, type TextSize } from './prefs';
import { useDisplayPrefs } from './useDisplayPrefs';

const SIZE_WORDS: Record<TextSize, { label: string; detail: string }> = {
  small: { label: 'Small', detail: 'Fits more on the screen' },
  medium: { label: 'Medium', detail: 'The size Komtru is drawn at' },
  large: { label: 'Large', detail: 'Easier to read' },
};

/**
 * SP-M33: text size, contrast, motion and a low-data mode. All of it is about this device, so none of it goes to the
 * platform: it is kept in this browser and applied to every page (`DisplayPrefsApplier`). Text size is a choice of three
 * rather than the reference's row that opens another screen, because three choices need no second screen.
 */
export function DisplayScreen(): React.JSX.Element {
  const [prefs, update] = useDisplayPrefs();

  return (
    <ScreenColumn>
      <ScreenHeader title="Display" backHref="/account" backLabel="Back to your account" />
      <SettingsGroup label="Text">
        <fieldset className="m-0 border-0 p-[14px]">
          <legend className="sr-only">Text size</legend>
          <p className="mb-[8px] text-[12.5px] font-semibold" aria-hidden>
            Text size
          </p>
          {TEXT_SIZES.map((size) => (
            <OptionCard
              key={size}
              name="text-size"
              value={size}
              checked={prefs.textSize === size}
              onChange={() => update({ textSize: size })}
              description={SIZE_WORDS[size].detail}
            >
              {SIZE_WORDS[size].label}
            </OptionCard>
          ))}
        </fieldset>
        <SettingsRow
          label="Bold text"
          control={
            <Toggle
              label="Bold text"
              checked={prefs.boldText}
              onChange={(boldText) => update({ boldText })}
            />
          }
        />
      </SettingsGroup>
      <SettingsGroup label="Comfort">
        <SettingsRow
          label="Higher contrast"
          sub="Stronger colours and borders"
          control={
            <Toggle
              label="Higher contrast"
              checked={prefs.highContrast}
              onChange={(highContrast) => update({ highContrast })}
            />
          }
        />
        <SettingsRow
          label="Reduce motion"
          sub="Fewer animations"
          control={
            <Toggle
              label="Reduce motion"
              checked={prefs.reduceMotion}
              onChange={(reduceMotion) => update({ reduceMotion })}
            />
          }
        />
      </SettingsGroup>
      <SettingsGroup label="Data">
        <SettingsRow
          label="Low-data mode"
          sub="Video waits until you play it, photos load as you scroll to them, on any network"
          control={
            <Toggle
              label="Low-data mode"
              checked={prefs.lowData}
              onChange={(lowData) => update({ lowData })}
            />
          }
        />
        <SettingsRow
          label="Download photos on Wi-Fi only"
          sub="On mobile data, photos wait for a tap. Where your browser can tell mobile data from Wi-Fi."
          control={
            <Toggle
              label="Download photos on Wi-Fi only"
              checked={prefs.wifiPhotosOnly}
              onChange={(wifiPhotosOnly) => update({ wifiPhotosOnly })}
            />
          }
        />
      </SettingsGroup>
      <NoteBanner>
        These settings are saved on this device. They don’t follow you to another phone.
      </NoteBanner>
      <p className="mt-[6px] text-[11.5px] leading-[1.6] text-trust-gray">
        Status is always shown with words as well as colour.
      </p>
    </ScreenColumn>
  );
}
