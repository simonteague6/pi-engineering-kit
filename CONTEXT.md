# Native Handoff

This context defines the language for transferring work between Pi sessions without losing the user’s place or requiring manual context copying.

## Session Transfer

**Handoff**:
A deliberate transfer of working context from a source session into a replacement session so work can continue in the same Pi window.
_Avoid_: Fork, new window, reset

**Source session**:
The session from which the user initiates a handoff and whose conversation remains available for later review.
_Avoid_: Old session

**Replacement session**:
The fresh session that receives the handoff context and waits for the user’s next instruction.
_Avoid_: New conversation, new window

## Subagent execution language

**Run**:
One execution of a single node, parallel group, or chain.
_Avoid_: Job, task (when referring to the whole execution)

**Node**:
One agent invocation inside a run.
_Avoid_: Step (when the position is not the main concern)

**Blocking execution**:
A run whose active parent turn stays open until the run returns a terminal result.
_Avoid_: Foreground

**Detached execution**:
A run that continues after the parent turn ends. The parent remains available and receives completion notifications.
_Avoid_: Background (as the runtime term)

**Suspension**:
A non-terminal frozen run that can resume from its latest durable checkpoint.
_Avoid_: Cancellation, stop

**Cancellation**:
A terminal decision to end a run. A cancelled run cannot resume.
_Avoid_: Suspension, pause

**Internal completion event**:
A runtime record for every child state change, including successful node completion. It is available for status and inspection but does not automatically enter parent context.
_Avoid_: Parent notification

**Parent notification**:
A queued, compact record surfaced to the parent for a child failure, cancellation, suspension, or final graph result. It does not interrupt an active parent turn.
_Avoid_: Completion event, interrupt, tool call

**Auto-resume**:
A runtime-started parent turn that processes a parent notification when the parent is idle. If the parent is busy, the notification waits without interrupting the turn.
_Avoid_: Interrupt, forced turn

**Handoff memo**:
The complete plain-text output passed from one node to the next. It is separate from compact parent notifications and is not truncated.
_Avoid_: Parent summary, transcript

**Logical role**:
The parent-assigned responsibility for a node, such as `Backend Researcher`. It identifies the work for the parent and runtime, but it is not an execution identity and need not be shown to the child.
_Avoid_: Node ID, agent ID

**Recovery run**:
A new run that replaces failed logical roles and continues the remaining graph using artifacts from the original run.
_Avoid_: Continuation graph, mutated run

**Handoff marker**:
A compact, durable TUI record in the source session showing that a handoff occurred and identifying its artifact.
_Avoid_: Notification, custom LLM message

## Context Boundaries

**Conversation context**:
The active branch of a session, including relevant user and assistant messages, tool results, and compaction summaries.
_Avoid_: Chat history, native context

**Resource context**:
The project and global instructions and resources that Pi loads independently for each session.
_Avoid_: Native context, background context

## Handoff Content

**Handoff artifact**:
The human-readable document produced during a handoff and stored outside the project workspace for inspection or recovery.
_Avoid_: Handoff file, summary file

**Handoff context**:
The artifact’s content made available inside the replacement session before the user sends a new instruction.
_Avoid_: Initial prompt, automatic message

**Pending handoff**:
A replacement session that contains handoff context but has not yet sent a request to the model because the user has not submitted a new instruction.
_Avoid_: Auto-started session, queued prompt
