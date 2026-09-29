# Daily Planning: comparative design research

Research date: 29 September 2026. Scope: desktop personal planning, yesterday’s accomplishments, deliberate selection for today, one daily highlight, and the transition into doing the work.

## Recommendation

Keep the agreed sequence: review yesterday → choose today’s tasks and one highlight → open Today. Rework the screen composition around Ritua’s existing task components. The strongest reference combination is Sunsama/Ellie for the review sequence, Amazing Marvin/Microsoft To Do for keeping task sources beside the selected day, Things for restrained hierarchy, and Make Time for the meaning of the highlight.

This is comparative desk research using official documentation and published product imagery. It establishes useful patterns, not measured usability superiority. The twelve products below were compared through public material; they were not all tested in authenticated accounts. Older screenshots illustrate a pattern rather than guarantee the current release’s exact appearance. Some hosted image attachments could not be retrieved, including Akiflow’s signed daily-planning image.

## Twelve relevant products

| Product and primary source | Observed pattern | Application to Ritua | Trade-off / boundary |
| --- | --- | --- | --- |
| [Sunsama: daily planning](https://help.sunsama.com/docs/usage-guides/daily-planning/) | Review yesterday, gather tasks, consider workload, then finalize. Planning connects to existing tasks and external sources. | Give yesterday a clear beginning and keep task context available while building today. | Its full ritual includes more steps than Ritua needs. Do not inherit every stage. |
| [Ellie: daily rituals](https://guide.ellieplanner.com/features/daily-planning-shutdown-rituals) | Yesterday’s completed work and unfinished items lead into selection from lists, a capacity check, and finalizing. | Closest reference for the requested journey. Accomplishments should be actual tasks with recognizable context. | Charts and mandatory timeboxing would add work beyond the brief. |
| [Akiflow: rituals](https://product.akiflow.com/articles/0805246-rituals) and [goals](https://product.akiflow.com/help/articles/6614520-setting-goals) | Daily recap precedes deciding what to focus on. Goals remain ordinary tasks with a distinctive priority treatment; the guide suggests several daily goals. | Give the chosen highlight a persistent, explicit visual treatment that survives entry into Today. | Multiple goals differ from Ritua’s single highlight. A colored border alone is not an adequate label. |
| [Amazing Marvin: day planning](https://help.amazingmarvin.com/en/articles/5066364-day-planning) | A Master List sidebar opens beside the day; tasks can be dragged into the plan. Workload details remain available. | Strongest structural reference for keeping the source and destination visible simultaneously. | Its many strategies and statistics should not become requirements for a simple daily ritual. |
| [Microsoft To Do in Outlook: My Day](https://support.microsoft.com/en-us/outlook/create-and-manage-task-lists-with-my-day-in-outlook) | A Suggestions pane offers tasks with an explicit Add to My Day action. Tasks retain their original list membership. | Keep available tasks beside today’s shortlist; show source context and clear add/remove feedback. | Microsoft surfaces differ in automatic population and reset behavior. Borrow the interaction, not assumptions about rollover. |
| [Things: Today, Anytime and other lists](https://culturedcode.com/things/support/articles/4001304/) | A focused Today list can be reordered or grouped by area/project; calendar events appear above tasks. Evening items can form a quieter separate section. | Compact task rows, modest headings, and meaningful grouping can make a screen calm without making it empty. | Things uses its star for Today membership. That meaning must not be confused with Ritua’s highlight. |
| [Any.do: My Day](https://support.any.do/en/articles/8609724-getting-started-with-my-day) | Users intentionally add tasks to a daily shortlist, using suggestions or their existing lists. Resetting the view does not delete source tasks. | Separate having many tasks from committing to a few today. Preserve visible source identity. | Its [Moment ritual](https://support.any.do/en/articles/8635882-prioritize-your-day-with-any-do-moment) reviews personal tasks one at a time on mobile; this is a weaker desktop reference than a simultaneous overview. |
| [Todoist: Today](https://www.todoist.com/help/todoist/get-started/plan-your-day-with-the-today-view-UVUXaiSs) | Today aggregates scheduled tasks across projects; priorities help the most important tasks rise to the top. | Keep the highest-value commitment easy to locate after planning. Keep project context in rows. | Several priority levels and several top tasks do not express one date-specific highlight. |
| [TickTick: task details](https://help.ticktick.com/articles/7055782408586526720) | Priority and pinning are separate controls. Pinning keeps a task at the top when priority alone is insufficient. | Placement can reinforce the highlight, in addition to a label and icon. | More parallel priority mechanisms would create ambiguity. Ritua should have one clear daily-highlight action. |
| [Structured: getting started](https://help.structured.app/en/articles/380546) | The timeline is the main working surface; unscheduled tasks live in an inbox and can be placed into the day. | Keep the relationship between chosen work and the day visible. Color and secondary information should aid scanning. | A timeline-first design assumes users want to assign times. That should remain optional for this flow. |
| [Routine: planning and scheduling](https://help.routine.co/articles/6092827-planning-and-scheduling) | Assigning a task to a day, blocking calendar time, and postponing work are distinct actions. | Selecting “today” should not force another decision about an exact start time. | Bringing all three actions into every task row would overcomplicate selection. |
| [TeuxDeux](https://teuxdeux.com/) | Day lists and someday lists form a simple planning surface; unfinished tasks roll forward. | Keep ordinary planning edits immediate and visually lightweight. | Automatic carryover conflicts with the user’s desire to deliberately choose a few tasks. Do not copy that behavior by default. |

## Published visual references

These are reference images of existing products, not proposed Ritua screens. The source pages provide the surrounding context.

### Sunsama — workspace and guided planning

![Sunsama published guided-planning interface](https://pub-f7ae218077e542729e28e6f8f45a9a40.r2.dev/images/632dfa16f32c4631091a2ff2_home-feature-guided-daily-planning-min.png)

[Source: Sunsama daily planning](https://www.sunsama.com/daily-planning). Study the relationship between the planning instructions and the working task surface, rather than copying its full workflow.

### Things — Today hierarchy

![Things published Today list](https://culturedcode.com/frozen/2025/10/dates-today.jpg)

[Source: Things list guide](https://culturedcode.com/things/support/articles/4001304/). Study the relative emphasis of the title, task names, context, and optional sections. This is a hierarchy reference, not a task-selection flow.

### Ellie — tasks, source lists and daily context

![Ellie published planner interface](https://framerusercontent.com/assets/urY817SzD6bVLjSGuoDxVLFP0mQ.jpg)

[Source: Ellie About](https://ellieplanner.com/about). This published overview shows the relationship between source tasks, day columns and calendar context; it is not the daily ritual screen. The [ritual guide](https://guide.ellieplanner.com/features/daily-planning-shutdown-rituals) documents the specific review-to-planning journey.

### Amazing Marvin — source beside the plan

[Animated planning demonstration on AppSumo](https://appsumo.com/products/amazing-marvin/) and [official scheduling guide](https://help.amazingmarvin.com/en/articles/2364023-how-to-schedule-tasks-into-your-days). The demonstration is an older visual reference. The official guide explicitly recommends a planning sidebar so the user can keep the day in view while selecting work.

## What went wrong in the rejected Ritua redesign

These are design judgments grounded in the local before/after screenshots and the user’s feedback, not findings from a usability study.

| Issue | Effect on the requested task | Correction |
| --- | --- | --- |
| Main task selection lived in a large dropdown | Opening it obscured the plan being assembled and required repeated browsing through a transient surface. | Make source tasks a stable pane, beside today’s selection. Use dropdowns for filters and secondary choices. |
| Large introductory typography and a narrow central column | The desktop area was underused while the useful task content occupied a small portion of the screen. | Match Ritua’s existing heading scale, task density and content grid. |
| Rows and controls felt detached from the existing workspace | The new ritual looked like a separate product rather than part of Ritua. | Reuse production task components, spacing, area labels and Phosphor icons. |
| A star carried most of the meaning of “daily highlight” | The distinction between selecting a task and making it the highlight was too weak. | Add an explicit “Daily highlight” label and a clear selected state. |
| Empty space was used as the main source of calm | Users still had to hunt for the important controls and task context. | Create calm through hierarchy, alignment, useful grouping and limited simultaneous decisions. |

The recognition-over-recall principle supports keeping relevant choices and context visible. Progressive disclosure supports hiding secondary detail; it does not justify concealing the core task-selection workspace. These are established design principles, not proof that a specific pane arrangement will succeed. [NN/g: recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/), [NN/g: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

## Proposed Ritua experience

### 1. Yesterday

Keep the existing app shell and a modest title: “Yesterday”. Display completed tasks with their area/project context in familiar components. A compact count can summarize the list; use actual time only where recorded data makes it meaningful. Do not make charts or written reflection prerequisites.

The primary action is “Plan today”. Unfinished work should be available in the next screen as a source to choose from, without framing it as failure. For an empty day, use a short neutral message and retain the same obvious next action.

### 2. Plan today

Use the available desktop width for two stable content panes within the existing Ritua shell:

| Available tasks | Today’s plan |
| --- | --- |
| Search and existing area/project filters | Selected-task count and optional known duration |
| Unfinished from yesterday | The chosen daily highlight, clearly labeled |
| Anytime and project tasks | Remaining selected tasks in a compact list |
| Explicit add action on every row | Remove, reorder and change-highlight actions |
| Familiar inline task creation | Persistent “Start my day” action |

Selecting a task updates today’s pane immediately and leaves an unambiguous selected marker at the source. The add control must not resemble completing a task. Click and keyboard interactions should be sufficient; dragging can be an additional convenience. Search must not erase the selection or reset the resulting plan.

Use a gentle prompt to choose a small number of tasks rather than an arbitrary hard limit. A task with no duration should stay unknown; do not invent estimates to produce a reassuring capacity score. The calendar can remain secondary because the user asked to choose work before entering Today.

At narrow widths, preserve an accessible view of the chosen plan through a compact summary and a directly accessible selection surface. Do not squeeze two panes until titles or controls become unusable. The exact narrow-window treatment requires a visual prototype.

### 3. One daily highlight

Make Time defines the highlight as one activity deliberately chosen as the day’s focal point. It may be urgent, satisfying or joyful; it is not necessarily the most overdue work task. This is the closest conceptual match to the user’s request. [Original explanation by John Zeratsky](https://maketime.blog/article/choose-a-highlight-to-make-time-every-day/).

For Ritua, recommend one highlight among the chosen tasks, with a text label, subtle accent and stable placement. Choosing another replaces the previous highlight. Removing that task clears the designation and prompts a replacement. The interface should explain the missing choice next to the action, rather than leave an unexplained disabled button. Preserve an explicit route for a day with no planned tasks.

“Start my day” saves the choices and opens Today directly. Today displays the same selected tasks and the same highlight. Changing the highlight later should be easy; planning is a useful commitment, not a lock.

## Visual direction and validation

The next visual pass should begin with Ritua’s original production spacing, surfaces and task components. Use the comparison above to change composition and hierarchy. Reserve the strongest emphasis for the primary action and the highlight; keep project metadata secondary. Avoid oversized welcome text, ornamental cards, prominent dashboard metrics and an extra full-screen step just to choose the highlight.

Before implementing the next version, review populated visuals of both planning screens at a normal desktop size and a narrow window. Include long titles, several projects, no completed tasks, no selected tasks, many available tasks and a changed highlight. Then test the complete journey: identify yesterday’s accomplishments, select three tasks from different sources, designate one highlight, undo an accidental selection, return to yesterday and back without losing choices, and enter Today with the exact plan preserved. These are proposed checks; this research does not claim that the revised design has passed them.

The highest-confidence correction is keeping source tasks and the emerging plan visible together. The precise pane proportions, highlight placement and narrow-window behavior remain design decisions to validate in the next visual prototype.
