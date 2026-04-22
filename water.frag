#version 450

layout(push_constant) uniform WaterPush {
vec3 camera_ws;
//shared with vertex shader
float time;
float wave_strength;
float foam_strength;
float depth_near; //proxy start distance for shallow->deep transition
float depth_far;
float _pad0;
float _pad1;
float _pad2;
float _pad3;
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

 void main(){
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
	vec3 v = normalize(uWater.camera_ws - v_world_pos);
	float NoV = clamp(dot(n, v), 0.0, 1.0);

  // Reflection/transmission split.
	float reflection_w = fresnel_schlick(NoV, 0.02);
	float transmission_w = 1.0 - reflection_w;

	// Distance and angle-aware water depth proxy.
	float view_depth = length(uWater.camera_ws - v_world_pos);
	float depth_t = smoothstep(uWater.depth_near, uWater.depth_far, view_depth);

  float grazing = 1.0 - NoV;
	float optical_path = mix(view_depth, view_depth * 2.2, grazing);

	// Beer-Lambert absorption + shallow/deep tinting.
	vec3 deep = vec3(0.03, 0.19, 0.30);
	vec3 shallow = vec3(0.09, 0.46, 0.52);
	vec3 water_tint = mix(shallow, deep, depth_t);
	vec3 absorption = vec3(0.13, 0.07, 0.04);
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
	vec2 ss_distort = n.xz * 0.024 + (micro - 0.5) * 0.020 + ss_wave;
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
	float depth_delta = clamp(scene_depth - surface_depth, 0.0, 1.0);
	float thickness_t = smoothstep(0.001, 0.040, depth_delta);

	// Blend a bit of env-based transmission for stability near screen edges / missing detail.
	vec3 refraction_env = texture(envTex, T).rgb;
	vec3 refraction_proxy = mix(scene_refracted, refraction_env, 0.18) * refraction_tint;
	vec3 reflection_proxy = texture(envTex, R).rgb;

	// Richer foam: crest foam + shoreline-ish foam.
	float crest = smoothstep(0.35, 0.85, 1.0 - n.y);
	float crest_height = smoothstep(0.006, 0.030, max(v_wave_height, 0.0));
	float shoreline = 1.0 - thickness_t;
	float foam_wave_a = 0.5 + 0.5 * sin(dot(v_uv, vec2(31.0, 21.0)) + uWater.time * 1.45);
	float foam_wave_b = 0.5 + 0.5 * sin(dot(v_world_pos.xz, vec2(7.5, 5.6)) - uWater.time * 0.95);
	float foam_pattern = smoothstep(0.60, 0.92, foam_wave_a * 0.65 + foam_wave_b * 0.35);
	float foam_mask = foam_pattern * (0.35 * crest + 0.35 * crest_height + 0.30 * shoreline) * uWater.foam_strength;
	vec3 foam = vec3(0.93, 0.97, 1.0) * foam_mask;

	// Final water color and alpha.
	vec3 color = reflection_proxy * reflection_w + refraction_proxy * transmission_w + foam;
	float alpha = mix(0.22, 0.52, depth_t) + 0.10 * grazing + 0.10 * (1.0 - thickness_t);
	outColor = vec4(color, clamp(alpha, 0.20, 0.60));
}