//! Environment-driven configuration.
//!
//! Every value is read through [`Config::from_lookup`], which takes a lookup function instead of
//! touching `std::env` directly. Tests therefore never mutate the real process environment
//! (`std::env::set_var` is `unsafe` in edition 2024 and racy across test threads).
//!
//! All variables are prefixed `ATTENDANCE_ENGINE_` so they can never collide with — or silently
//! pick up — the NestJS API's `DATABASE_URL` / JWT secrets from the monorepo root `.env`.

use std::fmt;
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

use sqlx::postgres::PgConnectOptions;

pub const ENV_ENVIRONMENT: &str = "ATTENDANCE_ENGINE_ENV";
pub const ENV_HOST: &str = "ATTENDANCE_ENGINE_HOST";
pub const ENV_PORT: &str = "ATTENDANCE_ENGINE_PORT";
pub const ENV_DATABASE_URL: &str = "ATTENDANCE_ENGINE_DATABASE_URL";
pub const ENV_DB_MAX_CONNECTIONS: &str = "ATTENDANCE_ENGINE_DB_MAX_CONNECTIONS";
pub const ENV_DB_MIN_CONNECTIONS: &str = "ATTENDANCE_ENGINE_DB_MIN_CONNECTIONS";
pub const ENV_DB_ACQUIRE_TIMEOUT_MS: &str = "ATTENDANCE_ENGINE_DB_ACQUIRE_TIMEOUT_MS";
pub const ENV_DB_STATEMENT_TIMEOUT_MS: &str = "ATTENDANCE_ENGINE_DB_STATEMENT_TIMEOUT_MS";
pub const ENV_READINESS_TIMEOUT_MS: &str = "ATTENDANCE_ENGINE_READINESS_TIMEOUT_MS";
pub const ENV_REQUEST_TIMEOUT_MS: &str = "ATTENDANCE_ENGINE_REQUEST_TIMEOUT_MS";
pub const ENV_SHUTDOWN_GRACE_MS: &str = "ATTENDANCE_ENGINE_SHUTDOWN_GRACE_MS";
pub const ENV_LOG_FORMAT: &str = "ATTENDANCE_ENGINE_LOG_FORMAT";

/// Default development port. Chosen to avoid web (3000), api (4000), PostgreSQL (5432) and
/// Expo/Metro (8081), which are already in use on the development machine.
pub const DEFAULT_PORT: u16 = 4100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Environment {
    Development,
    Production,
}

impl Environment {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Development => "development",
            Self::Production => "production",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Json,
    Pretty,
}

/// A value that must never appear in logs, error messages or `Debug` output.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    pub url: Secret,
    pub max_connections: u32,
    pub min_connections: u32,
    pub acquire_timeout: Duration,
    pub statement_timeout: Duration,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub environment: Environment,
    pub host: IpAddr,
    pub port: u16,
    /// `None` only in development. Production refuses to start without it.
    pub database: Option<DatabaseConfig>,
    pub readiness_timeout: Duration,
    pub request_timeout: Duration,
    pub shutdown_grace: Duration,
    pub log_format: LogFormat,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{key} is required: {reason}")]
    Missing {
        key: &'static str,
        reason: &'static str,
    },
    /// `reason` never contains the raw value for secret keys.
    #[error("{key} is invalid: {reason}")]
    Invalid { key: &'static str, reason: String },
}

impl Config {
    /// Reads configuration from the real process environment.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Reads configuration through `lookup`. Empty / whitespace-only values are treated as unset.
    pub fn from_lookup<F>(lookup: F) -> Result<Self, ConfigError>
    where
        F: Fn(&str) -> Option<String>,
    {
        let get = |key: &str| {
            lookup(key)
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
        };

        let environment = match get(ENV_ENVIRONMENT).as_deref() {
            None | Some("development") => Environment::Development,
            Some("production") => Environment::Production,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    key: ENV_ENVIRONMENT,
                    reason: format!("expected \"development\" or \"production\", got \"{other}\""),
                });
            }
        };

        let host = match get(ENV_HOST) {
            None => IpAddr::from([127, 0, 0, 1]),
            Some(raw) => raw.parse::<IpAddr>().map_err(|_| ConfigError::Invalid {
                key: ENV_HOST,
                reason: format!("expected an IP address, got \"{raw}\""),
            })?,
        };

        let port = match get(ENV_PORT) {
            None => DEFAULT_PORT,
            Some(raw) => match raw.parse::<u16>() {
                Ok(0) | Err(_) => {
                    return Err(ConfigError::Invalid {
                        key: ENV_PORT,
                        reason: format!("expected an integer between 1 and 65535, got \"{raw}\""),
                    });
                }
                Ok(port) => port,
            },
        };

        let database = match get(ENV_DATABASE_URL) {
            None if environment == Environment::Production => {
                return Err(ConfigError::Missing {
                    key: ENV_DATABASE_URL,
                    reason: "production requires a database connection",
                });
            }
            None => None,
            Some(url) => {
                // Parse now so a malformed URL fails at startup, not at first readiness probe.
                // The error deliberately omits the value: it may contain a password.
                // The scheme is checked explicitly because sqlx's parser does not reject e.g.
                // `mysql://` on its own.
                let invalid_url = || ConfigError::Invalid {
                    key: ENV_DATABASE_URL,
                    reason: "not a valid postgres:// or postgresql:// URL (value withheld)"
                        .to_owned(),
                };
                let lower = url.to_ascii_lowercase();
                if !(lower.starts_with("postgres://") || lower.starts_with("postgresql://")) {
                    return Err(invalid_url());
                }
                PgConnectOptions::from_str(&url).map_err(|_| invalid_url())?;

                let max_connections = parse_u32_in(&get, ENV_DB_MAX_CONNECTIONS, 5, 1, 100)?;
                let min_connections = parse_u32_in(&get, ENV_DB_MIN_CONNECTIONS, 0, 0, 100)?;
                if min_connections > max_connections {
                    return Err(ConfigError::Invalid {
                        key: ENV_DB_MIN_CONNECTIONS,
                        reason: format!(
                            "must not exceed {ENV_DB_MAX_CONNECTIONS} ({min_connections} > {max_connections})"
                        ),
                    });
                }

                Some(DatabaseConfig {
                    url: Secret::new(url),
                    max_connections,
                    min_connections,
                    acquire_timeout: parse_ms_in(
                        &get,
                        ENV_DB_ACQUIRE_TIMEOUT_MS,
                        3_000,
                        100,
                        60_000,
                    )?,
                    statement_timeout: parse_ms_in(
                        &get,
                        ENV_DB_STATEMENT_TIMEOUT_MS,
                        5_000,
                        100,
                        600_000,
                    )?,
                })
            }
        };

        let log_format = match get(ENV_LOG_FORMAT).as_deref() {
            None | Some("json") => LogFormat::Json,
            Some("pretty") => LogFormat::Pretty,
            Some(other) => {
                return Err(ConfigError::Invalid {
                    key: ENV_LOG_FORMAT,
                    reason: format!("expected \"json\" or \"pretty\", got \"{other}\""),
                });
            }
        };

        Ok(Self {
            environment,
            host,
            port,
            database,
            readiness_timeout: parse_ms_in(&get, ENV_READINESS_TIMEOUT_MS, 2_000, 100, 30_000)?,
            request_timeout: parse_ms_in(&get, ENV_REQUEST_TIMEOUT_MS, 10_000, 100, 300_000)?,
            shutdown_grace: parse_ms_in(&get, ENV_SHUTDOWN_GRACE_MS, 10_000, 0, 120_000)?,
            log_format,
        })
    }
}

fn parse_u32_in<G>(
    get: &G,
    key: &'static str,
    default: u32,
    min: u32,
    max: u32,
) -> Result<u32, ConfigError>
where
    G: Fn(&str) -> Option<String>,
{
    let Some(raw) = get(key) else {
        return Ok(default);
    };
    match raw.parse::<u32>() {
        Ok(value) if (min..=max).contains(&value) => Ok(value),
        _ => Err(ConfigError::Invalid {
            key,
            reason: format!("expected an integer between {min} and {max}, got \"{raw}\""),
        }),
    }
}

fn parse_ms_in<G>(
    get: &G,
    key: &'static str,
    default_ms: u32,
    min_ms: u32,
    max_ms: u32,
) -> Result<Duration, ConfigError>
where
    G: Fn(&str) -> Option<String>,
{
    parse_u32_in(get, key, default_ms, min_ms, max_ms)
        .map(|ms| Duration::from_millis(u64::from(ms)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |key| map.get(key).cloned()
    }

    const VALID_URL: &str = "postgresql://engine_ro:s3cr3t-pw@localhost:5432/recafco_hrms_dev";

    #[test]
    fn defaults_apply_when_nothing_is_set() {
        let config = Config::from_lookup(lookup(&[])).expect("defaults must be valid");
        assert_eq!(config.environment, Environment::Development);
        assert_eq!(config.port, DEFAULT_PORT);
        assert_eq!(config.host, IpAddr::from([127, 0, 0, 1]));
        assert!(config.database.is_none());
        assert_eq!(config.log_format, LogFormat::Json);
        assert_eq!(config.readiness_timeout, Duration::from_secs(2));
    }

    #[test]
    fn production_requires_database_url() {
        let err = Config::from_lookup(lookup(&[(ENV_ENVIRONMENT, "production")])).unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Missing {
                key: ENV_DATABASE_URL,
                ..
            }
        ));
    }

    #[test]
    fn blank_database_url_counts_as_missing_in_production() {
        let err = Config::from_lookup(lookup(&[
            (ENV_ENVIRONMENT, "production"),
            (ENV_DATABASE_URL, "   "),
        ]))
        .unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Missing {
                key: ENV_DATABASE_URL,
                ..
            }
        ));
    }

    #[test]
    fn production_with_database_url_is_valid() {
        let config = Config::from_lookup(lookup(&[
            (ENV_ENVIRONMENT, "production"),
            (ENV_DATABASE_URL, VALID_URL),
        ]))
        .expect("valid production config");
        let db = config.database.expect("database configured");
        assert_eq!(db.max_connections, 5);
        assert_eq!(db.min_connections, 0);
    }

    #[test]
    fn rejects_unknown_environment() {
        let err = Config::from_lookup(lookup(&[(ENV_ENVIRONMENT, "staging")])).unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Invalid {
                key: ENV_ENVIRONMENT,
                ..
            }
        ));
    }

    #[test]
    fn rejects_invalid_ports() {
        for bad in ["abc", "0", "65536", "-1", "4100.5"] {
            let err = Config::from_lookup(lookup(&[(ENV_PORT, bad)])).unwrap_err();
            assert!(
                matches!(err, ConfigError::Invalid { key: ENV_PORT, .. }),
                "port {bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn rejects_invalid_host() {
        let err = Config::from_lookup(lookup(&[(ENV_HOST, "localhost:4100")])).unwrap_err();
        assert!(matches!(err, ConfigError::Invalid { key: ENV_HOST, .. }));
    }

    #[test]
    fn rejects_malformed_database_url_without_echoing_it() {
        let err = Config::from_lookup(lookup(&[(ENV_DATABASE_URL, "mysql://u:hunter2@h/db")]))
            .unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Invalid {
                key: ENV_DATABASE_URL,
                ..
            }
        ));
        assert!(!err.to_string().contains("hunter2"));
    }

    #[test]
    fn rejects_out_of_range_pool_limits() {
        for (key, value) in [
            (ENV_DB_MAX_CONNECTIONS, "0"),
            (ENV_DB_MAX_CONNECTIONS, "1000"),
            (ENV_DB_MAX_CONNECTIONS, "many"),
            (ENV_DB_ACQUIRE_TIMEOUT_MS, "5"),
            (ENV_DB_STATEMENT_TIMEOUT_MS, "-100"),
        ] {
            let err = Config::from_lookup(lookup(&[(ENV_DATABASE_URL, VALID_URL), (key, value)]))
                .unwrap_err();
            assert!(
                matches!(err, ConfigError::Invalid { key: k, .. } if k == key),
                "{key}={value} should be rejected, got {err:?}"
            );
        }
    }

    #[test]
    fn rejects_min_connections_above_max() {
        let err = Config::from_lookup(lookup(&[
            (ENV_DATABASE_URL, VALID_URL),
            (ENV_DB_MAX_CONNECTIONS, "2"),
            (ENV_DB_MIN_CONNECTIONS, "3"),
        ]))
        .unwrap_err();
        assert!(matches!(
            err,
            ConfigError::Invalid {
                key: ENV_DB_MIN_CONNECTIONS,
                ..
            }
        ));
    }

    #[test]
    fn rejects_invalid_timeouts_and_log_format() {
        for (key, value) in [
            (ENV_READINESS_TIMEOUT_MS, "0"),
            (ENV_REQUEST_TIMEOUT_MS, "soon"),
            (ENV_SHUTDOWN_GRACE_MS, "999999999"),
            (ENV_LOG_FORMAT, "xml"),
        ] {
            let err = Config::from_lookup(lookup(&[(key, value)])).unwrap_err();
            assert!(
                matches!(err, ConfigError::Invalid { key: k, .. } if k == key),
                "{key}={value} should be rejected, got {err:?}"
            );
        }
    }

    #[test]
    fn debug_output_never_contains_the_database_password() {
        let config = Config::from_lookup(lookup(&[(ENV_DATABASE_URL, VALID_URL)])).unwrap();
        let debug = format!("{config:?}");
        assert!(!debug.contains("s3cr3t-pw"), "password leaked: {debug}");
        assert!(debug.contains("Secret(***)"));
    }
}
