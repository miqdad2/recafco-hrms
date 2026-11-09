//! Biometric attendance connector core (RUST-04) — design + synthetic verification only.
//!
//! STATUS: no RECAFCO biometric source has been connected. The source database engine, schema
//! and credentials are not yet provided by RECAFCO IT. This module is pure logic behind
//! `SourceReader`/`ImportSink` traits; a vendor-specific, read-only reader is added only after IT
//! confirms the source. Nothing here is wired to a route, scheduler or database.
//! See docs/architecture/biometric-integration.md.

pub mod connector;
pub mod direction;
pub mod event_key;
pub mod identity;
pub mod model;
pub mod timing;
