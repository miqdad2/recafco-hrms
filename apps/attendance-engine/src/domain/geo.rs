//! Geofence distance — the same haversine formula, operation order and Earth radius as
//! `calculateDistanceMeters` in `attendance-validation.service.ts`.

const EARTH_RADIUS_METERS: f64 = 6_371_000.0;

fn to_rad(deg: f64) -> f64 {
    // JS: (deg * Math.PI) / 180 — multiply first, then divide (same rounding).
    (deg * std::f64::consts::PI) / 180.0
}

/// Great-circle distance in meters from point 1 (the punch) to point 2 (the work location).
pub fn distance_meters(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let d_lat = to_rad(lat2 - lat1);
    let d_lon = to_rad(lon2 - lon1);
    let sin_lat = (d_lat / 2.0).sin();
    let sin_lon = (d_lon / 2.0).sin();
    let a = sin_lat * sin_lat + to_rad(lat1).cos() * to_rad(lat2).cos() * sin_lon * sin_lon;
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    EARTH_RADIUS_METERS * c
}

/// JavaScript `Math.round`: halves round toward +infinity (`-2.5 → -2`), unlike `f64::round`.
pub fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_distance_for_identical_points() {
        assert_eq!(distance_meters(29.3759, 47.9774, 29.3759, 47.9774), 0.0);
    }

    #[test]
    fn about_11_meters_per_ten_thousandth_degree_of_latitude() {
        let d = distance_meters(29.3760, 47.9774, 29.3759, 47.9774);
        assert!((d - 11.119).abs() < 0.01, "{d}");
    }

    #[test]
    fn js_round_matches_javascript_semantics() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-1800.5), -1800.0);
        assert_eq!(js_round(1112.4999), 1112.0);
        assert_eq!(js_round(0.499_999_999_999_999_94), 0.0);
    }
}
