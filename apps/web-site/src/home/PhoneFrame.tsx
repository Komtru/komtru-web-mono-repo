/**
 * An iPhone 16 Pro Max, drawn in CSS.
 *
 * The four `<i className="bt">` are the side buttons — silence switch, the two volume keys and the
 * action button on the right — positioned by the inline offsets the reference measured. They are
 * decoration on a decoration, so none of them is a control and none is announced.
 *
 * `aria-hidden` on the whole frame: what is inside it is a picture of an app, not the app. A screen
 * reader reading out a mock status bar and a mock text field would be reading out a lie.
 */
const BUTTONS = [
  'left:-4px;top:120px;height:30px',
  'left:-4px;top:176px;height:54px',
  'left:-4px;top:244px;height:54px',
  'right:-4px;top:210px;height:86px',
  'right:-4px;top:330px;height:56px',
];

const style = (declarations: string): React.CSSProperties =>
  Object.fromEntries(
    declarations.split(';').map((rule) => {
      const [property, value] = rule.split(':');
      return [property, value];
    }),
  ) as React.CSSProperties;

export function PhoneFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="pw" aria-hidden="true">
      <div className="zoom">
        <div className="ip">
          {BUTTONS.map((declarations) => (
            <i key={declarations} className="bt" style={style(declarations)} />
          ))}
          <div className="bz">
            <div className="scr">
              <div className="di" />
              <div className="sb">
                <span>9:41</span>
                <span>5G ▮▮▮</span>
              </div>
              <div className="host">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
