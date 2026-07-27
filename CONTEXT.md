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
