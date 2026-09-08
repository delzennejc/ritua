const textSections = (value) => value.split(/\n\s*\n/).map((block) => {
  const [title, ...lines] = block.split("\n");
  return { title, lines };
});

export function WeeklyTextCard({ value, onChange, ariaLabel }) {
  return (
    <div
      className="weekly-text-card"
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      onBlur={(event) => onChange(event.currentTarget.innerText.replace(/\n{3,}/g, "\n\n").trim())}
    >
      {textSections(value).map((section, sectionIndex) => (
        <div className="weekly-text-section" key={`${section.title}-${sectionIndex}`}>
          <strong className="weekly-text-title">{section.title}</strong>
          {section.lines.map((line, lineIndex) => (
            <div className="weekly-text-line" key={`${line}-${lineIndex}`}>{line}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
