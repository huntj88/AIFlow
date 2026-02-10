flow to review old dependencies
flow for plan reviewer to make sure it fits in the context of the rest of the app implementation

- "Make sure plan is using recomended patterns that are not superceded by new patterns in libraries."
- "Does plan refer to work in the checklist that is satisfied in a task that comes later? Make sure later work is properly captured in a different task document. Each task documents needs to have all of its dependencies already met before it can begin."
- "Can you make sure that <feature spec> is logically consistent with each file in docs folder?"

separate flow to mark checklist items.

- "Mark the completed items in the task checklist. Review each to make sure it can be marked as complete first. Commit the changes and handle any precommit hooks"

flow after planning to create questions to ask user for further plan refinement

"Create a list of _behaviors_ for <feature> to e2e later. Put in a markdown document <feature.behaviors>.md. put in feature-specs folder"

"Create an implementation plan for <feature>. This is a complex feature so break down the plan into many tasks under the <feature> task folder. Ensure task don't have circular dependencies. Ensure every aspect of the feature spec and behavior spec is taken into account. ultrathink."

---

"Review the <feature> tasks that have been done starting from task <number>. Were there any decisions or implementation details that would affect unfinished tasks? Update unfinished tasks with relevant details that emerged from tasks done so far. Think really hard on this."

"Review the State machine tasks that have been done starting from task 18. Were there any decisions or implementation details that would affect unfinished tasks? Update unfinished tasks with relevant details that emerged from tasks done so far. Call out any issues you find. Think really hard on this."

"Were there any decisions or implementation details from task <x> that would affect Task <X+1>? Update task <x+1> with relevant details."

## "create schedule to run <codeReview prompt> and <decisions/implementationDetails prompt> after a dependency group is done"

---

"review the code for <feature spec>"

## "Create a plan at task x.1 to fix the issues, but make sure they are consistent with future task requirments"

---

---

"why are there remaining items in the task checklist?"

## "update plan to remove the the items from the checklist that aren't achievable because the plan changed. Update unfished task plans with new behavior if relevant"

"can you make a plan to validate as many of the behaviors as you can by making network requests to server? e2e tests for server only."

AGENTS markdown file could contain: "For tests that expect the server to be running, prompt the user to start if not already running."
