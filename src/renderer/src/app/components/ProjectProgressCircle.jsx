export function projectTaskProgress(tasks = [], complete = false) {
  const completedTaskCount = tasks.filter((task) => task.complete).length;
  const taskCount = tasks.length;
  const isComplete = Boolean(complete) || (taskCount > 0 && completedTaskCount === taskCount);

  return {
    completedTaskCount,
    isComplete,
    progress: taskCount ? completedTaskCount / taskCount : 0,
    taskCount,
  };
}

export function ProjectProgressCircle({
  className = "",
  complete = false,
  size = 16,
  tasks = [],
}) {
  const { isComplete, progress } = projectTaskProgress(tasks, complete);

  return (
    <span
      aria-hidden="true"
      className={`project-progress-circle ${isComplete ? "complete" : ""} ${className}`.trim()}
      style={{
        "--project-progress-check-size": `${(size * 19) / 16}px`,
        "--project-progress-check-x": `${-size / 16}px`,
        "--project-progress-check-y": `${(-size * 1.5) / 16}px`,
        "--project-progress-size": `${size}px`,
      }}
    >
      {isComplete ? (
        <svg className="project-progress-circle-check" viewBox="0 0 256 256">
          <path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16">
          <circle className="project-progress-circle-track" cx="8" cy="8" r="7" />
          {progress > 0 ? (
            <circle
              className="project-progress-circle-value"
              cx="8"
              cy="8"
              r="7"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - (progress * 100)}
            />
          ) : null}
        </svg>
      )}
    </span>
  );
}
