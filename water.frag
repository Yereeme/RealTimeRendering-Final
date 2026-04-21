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
layout(location = 0) out vec4 outColor;

 float gerstner_like(vec2 uv, float t){
 //gerstner like toy for noe
 //real gerstner also displace x/z and use wave params
 //-here only synthesize a height pattern for shading
 // dot(uv, dir) is a projection: "how far along this direction are we?"
 // If dir points NE, projected value increases as we move NE.
 // Feeding that value into sin(...) creates a wave that is constant along
 // lines perpendicular to dir (wave crests), and oscillates along dir.
 float w0 = sin(dot(uv, normalize(vec2(1.0, 0.2))) * 32.0 + t * 1.4);
 float w1 = sin(dot(uv, normalize(vec2(-0.4, 1.0))) * 21.0 + t * 0.8);
	return 0.5 * w0 + 0.5 * w1;
 }

 void main(){
 // 1) Get animated pseudo-height at this pixel (h)
  float t = uWater.time;
  float h = gerstner_like(v_uv, t);

  //2) Turn local height slope into a fake normal (n)
 // dFdx/dFdy are screen-space derivatives: local slope across nearby pixels.
  float dx = dFdx(h);
  float dy = dFdy(h);
  vec3 n = normalize(vec3(-dx * 6.0, -dy * 6.0, 1.0));

  //3) view direction from surface point -> camera (world-space).
  vec3 v = normalize(uWater.camera_ws - v_world_pos);
  
  float fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);

  // 4) color proxy
	//   until true scene-depth refraction is wired, use camera distance as a stand-in.
	//nearer = shallower tint, farther = deeper tint

	vec3 deep = vec3(0.03, 0.19, 0.30);
	vec3 shallow = vec3(0.08, 0.40, 0.48);
	float view_depth = length(uWater.camera_ws - v_world_pos);
	float depth_t = smoothstep(uWater.depth_near, uWater.depth_far, view_depth);
	vec3 water = mix(shallow, deep, depth_t);

	// 5) Foam proxy on crests.
	//    smoothstep(a,b,x):
	//    - 0 below a
	//    - 1 above b
	//    - smooth blend in between
	float foam_mask = smoothstep(0.55, 0.9, h) * (1.0 - depth_t) *  uWater.foam_strength;
	vec3 foam = vec3(0.92, 0.96, 1.0) * foam_mask;

	// 6) Reflection look (very cheap approximation).
	//    Real version should sample environment map.
	vec3 reflection_tint = vec3(0.45, 0.62, 0.78) * fresnel;
	vec3 color = water + reflection_tint + foam;

	// 7) Alpha blend over scene.
	outColor = vec4(color, 0.35);
 }