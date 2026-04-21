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
//reserved for fragment foam control
float foam_strength;
//keep 16-byte layout (To make my GPU happy)
float _pad0;
float _pad1;
}uWater;

layout(location = 0) in vec3 Position;
layout(location = 2) in vec2 TexCoord;

layout(location = 0) out vec2 v_uv;
layout(location = 1) out vec3 v_world_pos;

void main() {
Transform transform = TRANSFORMS[gl_InstanceIndex];

v_uv = TexCoord;

vec4 local = vec4(Position, 1.0);
// Use two wave directions so the surface does not look like parallel strips.
vec2 p = Position.xz;
float phase0 = dot(p, normalize(vec2(1.0, 0.25))) * 3.2 + uWater.time * 1.1;
float phase1 = dot(p, normalize(vec2(-0.35, 1.0))) * 2.0 + uWater.time * 0.7;
float h = (sin(phase0) * 0.65 + sin(phase1) * 0.35) * 0.02;
local.y += h * uWater.wave_strength;

v_world_pos = (transform.WORLD_FROM_LOCAL * local).xyz;

gl_Position = transform.CLIP_FROM_LOCAL * local;
}