#version 450

struct Transform {
mat4 CLIP_FROM_LOCAL;
mat4 WORLD_FROM_LOCAL;
mat4 WORLD_FROM_LOCAL_NORMAL;
};

layout(set=0, binding=0, std140) readonly buffer Transforms {
Transform TRANSFORMS[];
};

layout(push_constant) uniform WaterPush {
vec3 camera_ws;
//seconds since app start (loops in c++)
float time;
//global multiplier for wave look
float wave_strength;
 //shoreline-style edge boost (used in fragment stage)
float foam_strength;
// proxy depth coloring controls (used in fragment stage)
float depth_near;
float depth_far;
float clip_near;
float clip_far;
// keep 16-byte layout (matches C++ push struct)
 
float _pad2;
float _pad3;
}uWater;

layout(location = 0) in vec3 Position;
layout(location = 1) in vec3 Normal;
layout(location = 2) in vec2 TexCoord;

layout(location = 0) out vec2 v_uv;
layout(location = 1) out vec3 v_world_pos;
layout(location = 2) out vec3 v_world_normal;
layout(location = 3) out vec2 v_screen_uv;
layout(location = 4) out float v_wave_height;

// A Gerstner wave is like pushing points in a repeating pattern where the
// surface moves up/down and slightly sideways, making sharper crests.
struct Wave {
	vec2 dir;
	float amplitude;
	float wavelength;
	float speed;
	float steepness;
};

const float PI = 3.14159265359;

void apply_gerstner_wave(
	Wave w,
	vec2 base_xz,
	inout vec3 displaced_local,
	inout vec3 dPdx,
	inout vec3 dPdz
) {
	vec2 D = normalize(w.dir);
	float k = 2.0 * PI / w.wavelength;     // spatial frequency
	float phase = k * dot(D, base_xz) + w.speed * uWater.time;
	float c = cos(phase);
	float s = sin(phase);

	// Clamp q to keep wave shapes stable (avoid "looping over" artifacts).
	float q = clamp(w.steepness / max(k * w.amplitude, 1e-4), 0.0, 1.0);

	// Position displacement.
	displaced_local.x += q * w.amplitude * D.x * c;
	displaced_local.y += w.amplitude * s;
	displaced_local.z += q * w.amplitude * D.y * c;

	// Analytic partial derivatives (for robust normals).
	// NOTE: don't use the identifier `common` (reserved token in GLSL).
	float deriv_term = q * w.amplitude * k * s;
	dPdx += vec3(
		-deriv_term * D.x * D.x,
		 w.amplitude * k * D.x * c,
		-deriv_term * D.x * D.y
	);
	dPdz += vec3(
		-deriv_term * D.x * D.y,
		 w.amplitude * k * D.y * c,
		-deriv_term * D.y * D.y
	);
}

void main() {
Transform transform = TRANSFORMS[gl_InstanceIndex];

v_uv = TexCoord;

vec3 displaced_local = Position;
vec2 base_xz = Position.xz;
 
// I use a small stack of directional waves (macro motion).
// Later can turn these into data-driven material parameters.
Wave waves[3] = Wave[](
	Wave(vec2( 1.0,  0.25), 0.030 * uWater.wave_strength, 1.25, 1.20, 0.45),
	Wave(vec2(-0.35, 1.0 ), 0.020 * uWater.wave_strength, 0.85, 0.90, 0.35),
	Wave(vec2( 0.2,  1.0 ), 0.012 * uWater.wave_strength, 0.55, 1.60, 0.25)
);

vec3 dPdx = vec3(1.0, 0.0, 0.0);
vec3 dPdz = vec3(0.0, 0.0, 1.0);
for (int i = 0; i < 3; ++i) {
	apply_gerstner_wave(waves[i], base_xz, displaced_local, dPdx, dPdz);
}

vec4 local = vec4(displaced_local, 1.0);
vec4 clip_pos = transform.CLIP_FROM_LOCAL * local;

v_world_pos = (transform.WORLD_FROM_LOCAL * local).xyz;


vec3 local_normal = normalize(cross(dPdz, dPdx));
v_world_normal = normalize((transform.WORLD_FROM_LOCAL_NORMAL * vec4(local_normal, 0.0)).xyz);
v_screen_uv = clip_pos.xy / max(clip_pos.w, 1e-6) * 0.5 + 0.5;
v_wave_height = displaced_local.y - Position.y;

gl_Position = clip_pos;
}