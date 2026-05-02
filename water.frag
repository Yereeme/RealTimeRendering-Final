#version 450

layout(push_constant) uniform WaterPush {
float camera_ws_x;
float camera_ws_y;
float camera_ws_z;
//shared with vertex shader
float time;
float wave_strength;
float foam_strength;
float depth_near; //proxy start distance for shallow->deep transition
float depth_far;
float fresnel_f0;
float refraction_distort;
float shallow_r;
float shallow_g;
float shallow_b;
float absorption_r;
float deep_r;
float deep_g;
float deep_b;
float absorption_g;
float absorption_b;
float reflection_boost;
float refraction_boost;
float foam_cutoff;
float camera_near;
float camera_far;
float thickness_min;
float thickness_max;
int debug_view;
float _pad0;
}uWater;

layout (location = 0) in vec2 v_uv;
layout (location = 1) in vec3 v_world_pos;
layout (location = 2) in vec3 v_world_normal;
layout(location = 3) in vec2 v_screen_uv;
layout(location = 4) in float v_wave_height;
layout(location = 0) out vec4 outColor;
layout(set=1, binding=0) uniform samplerCube envTex;
layout(set=1, binding=1) uniform sampler2D sceneColorTex;
layout(set=1, binding=2) uniform sampler2D sceneDepthTex;
layout(set=1, binding=3) uniform sampler2D waterNormalTex;

  float fresnel_schlick(float cosTheta, float F0) {
	// Schlick approximation:
	// Reflectance increases at grazing angles.
	return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float a = hash12(i);
	float b = hash12(i + vec2(1.0, 0.0));
	float c = hash12(i + vec2(0.0, 1.0));
	float d = hash12(i + vec2(1.0, 1.0));
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float linearize_depth(float depth01, float near_, float far_) {
	float n = max(near_, 1e-4);
	float f = max(far_, n + 1e-3);
	return (n * f) / max(f + depth01 * (n - f), 1e-6);
}

 void main(){
 vec3 camera_ws = vec3(uWater.camera_ws_x, uWater.camera_ws_y, uWater.camera_ws_z);
 // Stable geometric normal from the vertex-stage Gerstner derivatives.
	// Blend in scrolling normal-map micro detail in projected XZ space.
	vec3 geo_n = normalize(v_world_normal);
	vec2 nm_uv0 = v_world_pos.xz * 0.22 + vec2(0.03, -0.02) * uWater.time;
	vec2 nm_uv1 = v_world_pos.xz * 0.47 + vec2(-0.06, 0.05) * uWater.time;
	vec3 nm0 = texture(waterNormalTex, nm_uv0).xyz * 2.0 - 1.0;
	vec3 nm1 = texture(waterNormalTex, nm_uv1).xyz * 2.0 - 1.0;
	vec2 micro_xz = normalize(nm0.xz + nm1.xz + vec2(1e-5));
	vec3 n = normalize(vec3(
		geo_n.x + micro_xz.x * 0.16,
		geo_n.y,
		geo_n.z + micro_xz.y * 0.16
	));
	vec3 v = normalize(camera_ws - v_world_pos);
	float NoV = clamp(dot(n, v), 0.0, 1.0);

  // Reflection/transmission split.
	float reflection_w = fresnel_schlick(NoV, clamp(uWater.fresnel_f0, 0.0, 1.0));
	float transmission_w = 1.0 - reflection_w;

	// Distance and angle-aware water depth proxy.
	float view_depth = length(camera_ws - v_world_pos);
	float depth_t = smoothstep(uWater.depth_near, uWater.depth_far, view_depth);

  float grazing = 1.0 - NoV;
	float optical_path = mix(view_depth, view_depth * 2.2, grazing);

	// Beer-Lambert absorption + shallow/deep tinting.
	vec3 deep = vec3(uWater.deep_r, uWater.deep_g, uWater.deep_b);
	vec3 shallow = vec3(uWater.shallow_r, uWater.shallow_g, uWater.shallow_b);
	vec3 water_tint = mix(shallow, deep, depth_t);
	vec3 absorption = vec3(uWater.absorption_r, uWater.absorption_g, uWater.absorption_b);
	vec3 transmission_tint = exp(-absorption * max(optical_path, 0.0));
	vec3 refraction_tint = water_tint * transmission_tint;

	// Multi-frequency distortion anchored in world-space + screen-space UV.
	vec2 screen_uv = clamp(v_screen_uv, vec2(0.0), vec2(1.0));
	vec2 p = v_world_pos.xz;
	float n0 = noise2(p * 0.90 + vec2(0.18, -0.12) * uWater.time);
	float n1 = noise2(p * 2.70 + vec2(-0.33, 0.27) * uWater.time);
	float micro = n0 * 0.65 + n1 * 0.35;
	vec2 ss_wave = vec2(
		sin(screen_uv.y * 17.0 + uWater.time * 0.8),
		cos(screen_uv.x * 13.0 - uWater.time * 0.7)
	) * 0.0035;
	vec2 ss_distort = n.xz * uWater.refraction_distort + (micro - 0.5) * (uWater.refraction_distort * 0.8) + ss_wave;
	vec2 refr_uv = clamp(screen_uv + ss_distort, vec2(0.001), vec2(0.999));

	// Refraction from scene color (screen space), reflection from env cube.
	vec3 refract_normal = normalize(vec3(n.x + ss_distort.x, n.y, n.z + ss_distort.y));
	float eta = 1.0 / 1.333; // n_air / n_water
	vec3 T = refract(-v, refract_normal, eta);
	vec3 R = reflect(-v, n);
	vec3 scene_refracted = texture(sceneColorTex, refr_uv).rgb;

	// Depth intersection proxy from current-fragment depth vs refracted scene depth.
	float scene_depth = texture(sceneDepthTex, refr_uv).r;
	float surface_depth = gl_FragCoord.z;
	float scene_linear = linearize_depth(scene_depth, uWater.camera_near, uWater.camera_far);
	float surface_linear = linearize_depth(surface_depth, uWater.camera_near, uWater.camera_far);
	float depth_delta = max(scene_linear - surface_linear, 0.0);
	float thickness_t = smoothstep(
		max(0.0, uWater.thickness_min),
		max(uWater.thickness_min + 1e-4, uWater.thickness_max),
		depth_delta
	);

	// Blend a bit of env-based transmission for stability near screen edges / missing detail.
	vec3 refraction_env = texture(envTex, T).rgb;
vec3 refraction_proxy = mix(scene_refracted, refraction_env, 0.18) * refraction_tint * uWater.refraction_boost;
	vec3 reflection_proxy = texture(envTex, R).rgb * uWater.reflection_boost;

	// Richer foam: crest foam + shoreline-ish foam.
	float crest = smoothstep(0.35, 0.85, 1.0 - n.y);
	float crest_height = smoothstep(0.006, 0.030, max(v_wave_height, 0.0));
	float shoreline = 1.0 - thickness_t;

	// Texture-driven foam breakup in world-space (reuses water detail normal texture).
	vec2 foam_uv_a = v_world_pos.xz * 0.085 + vec2(0.018, -0.013) * uWater.time;
	vec2 foam_uv_b = v_world_pos.xz * 0.210 + vec2(-0.031, 0.022) * uWater.time;
	float foam_tex_a = texture(waterNormalTex, foam_uv_a).x;
	float foam_tex_b = texture(waterNormalTex, foam_uv_b).y;
	float foam_mix = foam_tex_a * 0.60 + foam_tex_b * 0.40;
	float foam_pattern = smoothstep(clamp(uWater.foam_cutoff, 0.40, 0.95), 0.96, foam_mix);

	// Keep shoreline/intersection foam visible even when texture breakup is dark.
	float shoreline_foam = smoothstep(0.10, 0.85, shoreline);
	float crest_foam = (0.55 * crest + 0.45 * crest_height) * (0.30 + 0.70 * foam_pattern);
	float foam_mask = clamp((0.70 * shoreline_foam + 0.45 * crest_foam) * uWater.foam_strength, 0.0, 1.0);
	 vec3 foam = vec3(0.93, 0.97, 1.0) * foam_mask;

	// Debug views for fast tuning.
	if (uWater.debug_view == 1) {
		outColor = vec4(vec3(thickness_t), 1.0);
		return;
	}
	if (uWater.debug_view == 2) {
		outColor = vec4(vec3(clamp(foam_mask, 0.0, 1.0)), 1.0);
		return;
	}
	if (uWater.debug_view == 3) {
		outColor = vec4(vec3(reflection_w), 1.0);
		return;
	}

	// Shore lift: brighten/teal-shift near intersections to avoid mirror-only appearance.
	float shore_lift = smoothstep(0.10, 0.80, shoreline);
	vec3 shore_tint = mix(vec3(1.0), vec3(0.74, 0.92, 0.90), shore_lift);

	// Final water color and alpha.
	vec3 color = reflection_proxy * reflection_w + refraction_proxy * transmission_w + foam;
	color *= shore_tint;
	color += vec3(0.05, 0.11, 0.10) * shore_lift;
	float alpha = mix(0.22, 0.52, depth_t) + 0.10 * grazing + 0.10 * (1.0 - thickness_t);

alpha = mix(alpha, max(alpha, 0.46), shore_lift * 0.55);
	outColor = vec4(color, clamp(alpha, 0.20, 0.62));
}